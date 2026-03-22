mod a2a_stream_proto;
mod a2a_stream_behaviour;

use hyper::{Body, Method, Request, Response, Server, StatusCode};
use hyper::service::{make_service_fn, service_fn};
use hyperlocal::UnixServerExt;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::convert::Infallible;
use std::env;
use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use futures::{StreamExt, AsyncReadExt, AsyncWriteExt};
use libp2p::{
    identity,
    multiaddr::Protocol,
    ping,
    swarm::{NetworkBehaviour, Swarm, SwarmEvent},
    Multiaddr, PeerId, Transport,
};
use libp2p_request_response as rr;
use libp2p::swarm::StreamProtocol;
use tokio::sync::{mpsc, oneshot};
use async_trait::async_trait;

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

async fn json_response(status: StatusCode, value: serde_json::Value) -> Result<Response<Body>, Infallible> {
    let body = serde_json::to_string_pretty(&value).unwrap_or_else(|_| "{}".to_string());
    let mut resp = Response::new(Body::from(body));
    *resp.status_mut() = status;
    resp.headers_mut().insert(hyper::header::CONTENT_TYPE, hyper::header::HeaderValue::from_static("application/json; charset=utf-8"));
    resp.headers_mut().insert(hyper::header::CACHE_CONTROL, hyper::header::HeaderValue::from_static("no-store"));
    Ok(resp)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct A2AJsonRequest {
    body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct A2AJsonResponse {
    body: String,
}

// Length-prefixed JSON codec to avoid relying on EOF framing.
// libp2p-request-response's built-in json codec reads until EOF, which can
// lead to ConnectionClosed issues if the stream isn't closed exactly as expected.
#[derive(Clone, Default)]
struct A2AFramedJsonCodec;

#[async_trait]
impl rr::Codec for A2AFramedJsonCodec {
    type Protocol = StreamProtocol;
    type Request = A2AJsonRequest;
    type Response = A2AJsonResponse;

    async fn read_request<T>(&mut self, _: &Self::Protocol, io: &mut T) -> std::io::Result<Self::Request>
    where
        T: futures::AsyncRead + Unpin + Send,
    {
        let mut len_buf = [0u8; 4];
        io.read_exact(&mut len_buf).await?;
        let len = u32::from_be_bytes(len_buf) as usize;
        let mut data = vec![0u8; len];
        io.read_exact(&mut data).await?;
        Ok(serde_json::from_slice(&data)?)
    }

    async fn read_response<T>(&mut self, _: &Self::Protocol, io: &mut T) -> std::io::Result<Self::Response>
    where
        T: futures::AsyncRead + Unpin + Send,
    {
        let mut len_buf = [0u8; 4];
        io.read_exact(&mut len_buf).await?;
        let len = u32::from_be_bytes(len_buf) as usize;
        let mut data = vec![0u8; len];
        io.read_exact(&mut data).await?;
        Ok(serde_json::from_slice(&data)?)
    }

    async fn write_request<T>(&mut self, _: &Self::Protocol, io: &mut T, req: Self::Request) -> std::io::Result<()>
    where
        T: futures::AsyncWrite + Unpin + Send,
    {
        let data = serde_json::to_vec(&req)?;
        let len = (data.len() as u32).to_be_bytes();
        io.write_all(&len).await?;
        io.write_all(&data).await?;
        io.flush().await?;
        Ok(())
    }

    async fn write_response<T>(&mut self, _: &Self::Protocol, io: &mut T, resp: Self::Response) -> std::io::Result<()>
    where
        T: futures::AsyncWrite + Unpin + Send,
    {
        let data = serde_json::to_vec(&resp)?;
        let len = (data.len() as u32).to_be_bytes();
        io.write_all(&len).await?;
        io.write_all(&data).await?;
        io.flush().await?;
        Ok(())
    }
}

#[derive(NetworkBehaviour)]
struct Behaviour {
    ping: ping::Behaviour,
    rr: rr::Behaviour<A2AFramedJsonCodec>,
}

enum P2pCommand {
    Request {
        body: String,
        timeout_ms: u64,
        resp: oneshot::Sender<Result<String, String>>,
    },
}

async fn handle(req: Request<Body>, upstream: String, sock: String, p2p_info: Arc<Mutex<serde_json::Value>>, p2p_stream_tx: Option<StreamClientTx>, p2p_tx: Option<mpsc::Sender<P2pCommand>>) -> Result<Response<Body>, Infallible> {
    match (req.method(), req.uri().path()) {
        (&Method::GET, "/healthz") => {
            let info = p2p_info.lock().unwrap().clone();
            return json_response(StatusCode::OK, json!({
                "ok": true,
                "ts": now_iso(),
                "sock": sock,
                "upstream": upstream,
                "p2p": info
            })).await;
        }
        (&Method::POST, "/a2a/request") => {
            let bytes = hyper::body::to_bytes(req.into_body()).await;
            if bytes.is_err() {
                let mut resp = json_response(StatusCode::OK, json!({"ok": false, "error": {"code": "READ_BODY_FAILED"}})).await?;
                resp.headers_mut().insert("x-a2a-transport", hyper::header::HeaderValue::from_static("error"));
                return Ok(resp);
            }
            let body_bytes = bytes.unwrap().to_vec();
            let body_str = String::from_utf8(body_bytes.clone()).unwrap_or_else(|_| String::from_utf8_lossy(&body_bytes).to_string());

            // Top-level request budget to ensure no hangs / bounded worst-case latency.
            let budget_ms: u64 = env::var("A2A_REQUEST_BUDGET_MS").ok().and_then(|v| v.parse().ok()).unwrap_or(8000);
            let started = Instant::now();
            let remaining_ms = || -> u64 {
                budget_ms.saturating_sub(started.elapsed().as_millis() as u64)
            };
            let budget_exceeded = || {
                let mut resp = Response::new(Body::from(serde_json::to_string_pretty(&json!({
                    "ok": false,
                    "error": {"code": "BUDGET_EXCEEDED", "budget_ms": budget_ms}
                })).unwrap_or_else(|_| "{}".to_string())));
                *resp.status_mut() = StatusCode::OK;
                resp.headers_mut().insert(hyper::header::CONTENT_TYPE, hyper::header::HeaderValue::from_static("application/json; charset=utf-8"));
                resp.headers_mut().insert(hyper::header::CACHE_CONTROL, hyper::header::HeaderValue::from_static("no-store"));
                resp.headers_mut().insert("x-a2a-transport", hyper::header::HeaderValue::from_static("budget_timeout"));
                resp
            };

            // Phase C2: libp2p-stream bridge first (if configured)
            if let Some(tx) = p2p_stream_tx {
                let rm = remaining_ms();
                if rm == 0 { return Ok(budget_exceeded()); }

                let (sx, rx) = oneshot::channel();
                if tx.send(StreamClientCommand { body: body_str.clone(), resp: sx }).await.is_ok() {
                    let tmo = Duration::from_millis(rm.min(6000));
                    if let Ok(Ok(Ok(resp_body))) = tokio::time::timeout(tmo, rx).await {
                        let mut resp = Response::new(Body::from(resp_body));
                        *resp.status_mut() = StatusCode::OK;
                        resp.headers_mut().insert(hyper::header::CONTENT_TYPE, hyper::header::HeaderValue::from_static("application/json; charset=utf-8"));
                        resp.headers_mut().insert(hyper::header::CACHE_CONTROL, hyper::header::HeaderValue::from_static("no-store"));
                        resp.headers_mut().insert("x-a2a-transport", hyper::header::HeaderValue::from_static("libp2p-stream"));
                        return Ok(resp);
                    }
                }
            }

            // Phase C2: existing libp2p request-response path (fallback)
            if let Some(tx) = p2p_tx {
                let rm = remaining_ms();
                if rm == 0 { return Ok(budget_exceeded()); }

                let (sx, rx) = oneshot::channel();
                let cmd = P2pCommand::Request { body: body_str.clone(), timeout_ms: 8000, resp: sx };
                if tx.send(cmd).await.is_ok() {
                    let tmo = Duration::from_millis(rm.min(9000));
                    if let Ok(Ok(Ok(resp_body))) = tokio::time::timeout(tmo, rx).await {
                        let mut resp = Response::new(Body::from(resp_body));
                        *resp.status_mut() = StatusCode::OK;
                        resp.headers_mut().insert(hyper::header::CONTENT_TYPE, hyper::header::HeaderValue::from_static("application/json; charset=utf-8"));
                        resp.headers_mut().insert(hyper::header::CACHE_CONTROL, hyper::header::HeaderValue::from_static("no-store"));
                        resp.headers_mut().insert("x-a2a-transport", hyper::header::HeaderValue::from_static("libp2p-rr"));
                        return Ok(resp);
                    }
                }
            }

            // Relay fallback: proxy to upstream HTTP sidecar.
            let client = hyper::Client::new();
            let uri: hyper::Uri = match format!("{}/a2a/request", upstream.trim_end_matches('/')).parse() {
                Ok(u) => u,
                Err(_) => {
                    return json_response(StatusCode::OK, json!({"ok": false, "error": {"code": "UPSTREAM_URL_INVALID"}})).await;
                }
            };

            let proxy_req = Request::builder()
                .method(Method::POST)
                .uri(uri)
                .header("content-type", "application/json")
                .body(Body::from(body_bytes))
                .unwrap();

            let rm = remaining_ms();
            if rm == 0 { return Ok(budget_exceeded()); }

            match tokio::time::timeout(Duration::from_millis(rm), client.request(proxy_req)).await {
                Ok(Ok(mut r)) => {
                    let b = hyper::body::to_bytes(r.body_mut()).await.unwrap_or_default();
                    let mut resp = Response::new(Body::from(b));
                    *resp.status_mut() = r.status();
                    resp.headers_mut().insert(hyper::header::CONTENT_TYPE, hyper::header::HeaderValue::from_static("application/json; charset=utf-8"));
                    resp.headers_mut().insert(hyper::header::CACHE_CONTROL, hyper::header::HeaderValue::from_static("no-store"));
                    resp.headers_mut().insert("x-a2a-transport", hyper::header::HeaderValue::from_static("upstream_http"));
                    Ok(resp)
                }
                Ok(Err(e)) => {
                    let mut resp = json_response(StatusCode::OK, json!({"ok": false, "error": {"code": "UPSTREAM_UNREACHABLE", "message": e.to_string()}})).await?;
                    resp.headers_mut().insert("x-a2a-transport", hyper::header::HeaderValue::from_static("upstream_http_error"));
                    Ok(resp)
                }
                Err(_) => Ok(budget_exceeded()),
            }
        }
        _ => {
            let mut resp = json_response(StatusCode::NOT_FOUND, json!({"ok": false, "error": {"code": "NOT_FOUND"}})).await?;
            resp.headers_mut().insert("x-a2a-transport", hyper::header::HeaderValue::from_static("error"));
            Ok(resp)
        },
    }
}

fn peer_id_from_multiaddr(addr: &Multiaddr) -> Option<PeerId> {
    addr.iter().find_map(|p| match p {
        Protocol::P2p(peer) => Some(peer),
        _ => None,
    })
}

async fn start_libp2p(upstream: String, p2p_info: Arc<Mutex<serde_json::Value>>) -> Option<mpsc::Sender<P2pCommand>> {
    let enable = env::var("A2A_LIBP2P_ENABLE").unwrap_or_else(|_| "1".to_string());
    if enable == "0" || enable.to_lowercase() == "false" {
        *p2p_info.lock().unwrap() = json!({"enabled": false});
        return None;
    }

    let remote = env::var("A2A_LIBP2P_REMOTE_ADDR").ok();

    // Persist identity across restarts when A2A_LIBP2P_KEY_PATH is set.
    let key_path = env::var("A2A_LIBP2P_KEY_PATH").ok();
    let key = if let Some(p) = key_path.as_ref() {
        match std::fs::read(p) {
            Ok(bytes) => identity::Keypair::from_protobuf_encoding(&bytes).unwrap_or_else(|_| identity::Keypair::generate_ed25519()),
            Err(_) => identity::Keypair::generate_ed25519(),
        }
    } else {
        identity::Keypair::generate_ed25519()
    };

    if let Some(p) = key_path.as_ref() {
        // best-effort write
        if let Ok(bytes) = key.to_protobuf_encoding() {
            let _ = std::fs::create_dir_all(std::path::Path::new(p).parent().unwrap_or(std::path::Path::new("/")));
            let _ = std::fs::write(p, bytes);
        }
    }

    let peer_id = PeerId::from(key.public());

    let transport = libp2p::tcp::tokio::Transport::new(libp2p::tcp::Config::default().nodelay(true))
        .upgrade(libp2p::core::upgrade::Version::V1)
        .authenticate(libp2p::noise::Config::new(&key).expect("noise"))
        .multiplex(libp2p::yamux::Config::default())
        .boxed();

    let ping_behaviour = ping::Behaviour::new(ping::Config::new());

    let proto = StreamProtocol::new("/a2a/sidecar/request/0.1");
    let mut rr_cfg = rr::Config::default();
    rr_cfg.set_request_timeout(Duration::from_millis(8000));

    let rr_behaviour = rr::Behaviour::<A2AFramedJsonCodec>::new(
        [(proto, rr::ProtocolSupport::Full)],
        rr_cfg,
    );

    let behaviour = Behaviour { ping: ping_behaviour, rr: rr_behaviour };

    let mut swarm = Swarm::new(
        transport,
        behaviour,
        peer_id,
        libp2p::swarm::Config::with_tokio_executor(),
    );

    let listen_addr_str = env::var("A2A_LIBP2P_LISTEN_ADDR").unwrap_or_else(|_| "/ip4/0.0.0.0/tcp/0".to_string());
    let listen_addr: Multiaddr = listen_addr_str.parse().expect("listen");
    if let Err(e) = swarm.listen_on(listen_addr) {
        *p2p_info.lock().unwrap() = json!({"enabled": true, "peer_id": peer_id.to_string(), "error": format!("{e}")});
        return None;
    }

    let mut remote_peer: Option<PeerId> = None;
    if let Some(r) = remote {
        if let Ok(ma) = r.parse::<Multiaddr>() {
            remote_peer = peer_id_from_multiaddr(&ma);

            // Strip /p2p/<peer> from multiaddr for dialing the transport,
            // but keep the association in the request-response behaviour.
            let mut base = Multiaddr::empty();
            for p in ma.iter() {
                if matches!(p, Protocol::P2p(_)) { break; }
                base.push(p);
            }

            if let Some(pid) = remote_peer {
                swarm.behaviour_mut().rr.add_address(&pid, base.clone());
            }

            let _ = swarm.dial(base);
        }
    }

    let (tx, mut rx) = mpsc::channel::<P2pCommand>(32);

    let mut pending_out: HashMap<rr::OutboundRequestId, oneshot::Sender<Result<String, String>>> = HashMap::new();
    let http_client = hyper::Client::new();

    *p2p_info.lock().unwrap() = json!({
        "enabled": true,
        "peer_id": peer_id.to_string(),
        "listening": [],
        "remote_peer": remote_peer.map(|p| p.to_string()),
        "mode": "libp2p_request_response"
    });

    tokio::spawn(async move {
        let mut connected = false;
        loop {
            tokio::select! {
                Some(cmd) = rx.recv() => {
                    if let P2pCommand::Request { body, timeout_ms: _, resp } = cmd {
                        if let Some(peer) = remote_peer {
                            let id = swarm.behaviour_mut().rr.send_request(&peer, A2AJsonRequest { body });
                            eprintln!("{}", json!({"ok": true, "event": "LIBP2P_OUTBOUND_SEND", "ts": now_iso(), "request_id": format!("{:?}", id), "peer": peer.to_string()}).to_string());
                            pending_out.insert(id, resp);
                        } else {
                            let _ = resp.send(Err("NO_REMOTE_PEER".to_string()));
                        }
                    }
                }
                ev = swarm.select_next_some() => {
                    match ev {
                        SwarmEvent::NewListenAddr { address, .. } => {
                            let mut v = p2p_info.lock().unwrap();
                            let mut xs = v.get("listening").and_then(|x| x.as_array()).cloned().unwrap_or_default();
                            xs.push(json!(address.to_string()));
                            *v = json!({
                                "enabled": true,
                                "peer_id": peer_id.to_string(),
                                "listening": xs,
                                "remote_peer": remote_peer.map(|p| p.to_string()),
                                "mode": "libp2p_request_response"
                            });
                        }
                        SwarmEvent::ConnectionEstablished { peer_id: pid, .. } => {
                            eprintln!("{}", json!({"ok": true, "event": "LIBP2P_CONN_ESTABLISHED", "ts": now_iso(), "peer": pid.to_string()}).to_string());
                            if remote_peer.is_some() && Some(pid) == remote_peer {
                                connected = true;
                            }
                        }
                        SwarmEvent::Dialing { peer_id: Some(pid), .. } => {
                            eprintln!("{}", json!({"ok": true, "event": "LIBP2P_DIALING", "ts": now_iso(), "peer": pid.to_string()}).to_string());
                        }
                        SwarmEvent::OutgoingConnectionError { peer_id: pid, error, .. } => {
                            eprintln!("{}", json!({"ok": true, "event": "LIBP2P_DIAL_ERROR", "ts": now_iso(), "peer": pid.map(|p| p.to_string()), "error": format!("{error}")}).to_string());
                        }
                        SwarmEvent::Behaviour(BehaviourEvent::Rr(e)) => {
                            match e {
                                rr::Event::Message { message, .. } => {
                                    match message {
                                        rr::Message::Response { request_id, response } => {
                                            eprintln!("{}", json!({"ok": true, "event": "LIBP2P_OUTBOUND_RESPONSE", "ts": now_iso(), "request_id": format!("{:?}", request_id)}).to_string());
                                            if let Some(ch) = pending_out.remove(&request_id) {
                                                let _ = ch.send(Ok(response.body));
                                            }
                                        }
                                        rr::Message::Request { request_id, request, channel } => {
                                            eprintln!("{}", json!({"ok": true, "event": "LIBP2P_INBOUND_REQUEST", "ts": now_iso(), "request_id": format!("{:?}", request_id)}).to_string());
                                            // Inbound: Phase C2 test mode can echo immediately.
                                            let test_echo = env::var("A2A_LIBP2P_TEST_ECHO").ok().map(|v| v != "0" && v.to_lowercase() != "false").unwrap_or(false);
                                            if test_echo {
                                                match swarm.behaviour_mut().rr.send_response(channel, A2AJsonResponse{ body: request.body }) {
                                                    Ok(()) => {
                                                        eprintln!("{}", json!({"ok": true, "event": "LIBP2P_RESPONSE_SENT", "ts": now_iso(), "mode": "test_echo"}).to_string());
                                                    }
                                                    Err(e) => {
                                                        eprintln!("{}", json!({"ok": true, "event": "LIBP2P_RESPONSE_SEND_ERROR", "ts": now_iso(), "error": format!("{e:?}"), "mode": "test_echo"}).to_string());
                                                    }
                                                }
                                                continue;
                                            }

                                            // Inbound: proxy to upstream HTTP sidecar.
                                            let uri: hyper::Uri = match format!("{}/a2a/request", upstream.trim_end_matches('/')).parse() {
                                                Ok(u) => u,
                                                Err(_) => {
                                                    let _ = swarm.behaviour_mut().rr.send_response(channel, A2AJsonResponse{ body: "{\"ok\":false,\"error\":{\"code\":\"UPSTREAM_URL_INVALID\"}}".to_string()});
                                                    continue;
                                                }
                                            };

                                            let proxy_req = Request::builder()
                                                .method(Method::POST)
                                                .uri(uri)
                                                .header("content-type", "application/json")
                                                .body(Body::from(request.body.into_bytes()))
                                                .unwrap();

                                            let resp_body = match http_client.request(proxy_req).await {
                                                Ok(mut r) => {
                                                    let b = hyper::body::to_bytes(r.body_mut()).await.unwrap_or_default();
                                                    String::from_utf8(b.to_vec()).unwrap_or_else(|_| String::from_utf8_lossy(&b).to_string())
                                                }
                                                Err(_) => "{\"ok\":false,\"error\":{\"code\":\"UPSTREAM_UNREACHABLE\"}}".to_string(),
                                            };

                                            match swarm.behaviour_mut().rr.send_response(channel, A2AJsonResponse{ body: resp_body }) {
                                                Ok(()) => {
                                                    eprintln!("{}", json!({"ok": true, "event": "LIBP2P_RESPONSE_SENT", "ts": now_iso()}).to_string());
                                                }
                                                Err(e) => {
                                                    eprintln!("{}", json!({"ok": true, "event": "LIBP2P_RESPONSE_SEND_ERROR", "ts": now_iso(), "error": format!("{e:?}")}).to_string());
                                                }
                                            }
                                        }
                                    }
                                }
                                rr::Event::OutboundFailure { request_id, error, .. } => {
                                    eprintln!("{}", json!({"ok": true, "event": "LIBP2P_OUTBOUND_FAILURE", "ts": now_iso(), "request_id": format!("{:?}", request_id), "error": format!("{error:?}")}).to_string());
                                    if let Some(ch) = pending_out.remove(&request_id) {
                                        let _ = ch.send(Err(format!("OUTBOUND_FAILURE:{error:?}")));
                                    }
                                }
                                _ => {}
                            }
                        }
                        _ => {}
                    }
                }
            }
        }
    });

    Some(tx)
}

// ---
// Phase C2 (Scheme A) — minimal in-process libp2p-stream client bridge.
//
// This intentionally does NOT wire into HTTP yet.
// It provides an internal request/response API via mpsc+oneshot.
// ---

#[derive(Debug)]
struct StreamClientCommand {
    body: String,
    resp: oneshot::Sender<Result<String, String>>,
}

type StreamClientTx = mpsc::Sender<StreamClientCommand>;

fn strip_p2p(ma: &Multiaddr) -> Multiaddr {
    let mut base = Multiaddr::empty();
    for p in ma.iter() {
        if matches!(p, Protocol::P2p(_)) { break; }
        base.push(p);
    }
    base
}

async fn start_libp2p_stream_client(p2p_info: Arc<Mutex<serde_json::Value>>) -> Option<StreamClientTx> {
    // Gate: require remote addr.
    let remote = env::var("A2A_LIBP2P_REMOTE_ADDR").ok()?;
    let remote_ma: Multiaddr = remote.parse().ok()?;
    let remote_peer = peer_id_from_multiaddr(&remote_ma)?;

    let (tx, mut rx) = mpsc::channel::<StreamClientCommand>(16);

    let key = identity::Keypair::generate_ed25519();
    let peer_id = PeerId::from(key.public());

    let transport = libp2p::tcp::tokio::Transport::new(libp2p::tcp::Config::default().nodelay(true))
        .upgrade(libp2p::core::upgrade::Version::V1)
        .authenticate(libp2p::noise::Config::new(&key).expect("noise"))
        .multiplex(libp2p::yamux::Config::default())
        .boxed();

    let behaviour = crate::a2a_stream_behaviour::A2AStreamBehaviour::default();

    let mut swarm = Swarm::new(
        transport,
        behaviour,
        peer_id,
        libp2p::swarm::Config::with_tokio_executor(),
    );

    // Listen (ephemeral by default).
    let listen_addr_str = env::var("A2A_LIBP2P_LISTEN_ADDR").unwrap_or_else(|_| "/ip4/127.0.0.1/tcp/0".to_string());
    let listen_addr: Multiaddr = listen_addr_str.parse().ok()?;
    let _ = swarm.listen_on(listen_addr);

    // Dial remote.
    let base = strip_p2p(&remote_ma);
    let _ = swarm.dial(base);

    // Pending map: request_id -> oneshot sender.
    let mut pending: HashMap<String, oneshot::Sender<Result<String, String>>> = HashMap::new();
    // Queue commands until we are connected to remote_peer.
    let mut queue: std::collections::VecDeque<(String, String)> = std::collections::VecDeque::new();

    tokio::spawn(async move {
        *p2p_info.lock().unwrap() = json!({
            "enabled": true,
            "peer_id": peer_id.to_string(),
            "remote_peer": remote_peer.to_string(),
            "mode": "libp2p_stream_client"
        });

        let mut connected = false;

        loop {
            tokio::select! {
                Some(cmd) = rx.recv() => {
                    let request_id = format!("req-{}", chrono::Utc::now().timestamp_millis());
                    pending.insert(request_id.clone(), cmd.resp);
                    queue.push_back((request_id, cmd.body));
                }
                ev = swarm.select_next_some() => {
                    match ev {
                        SwarmEvent::ConnectionEstablished { peer_id: pid, .. } => {
                            if pid == remote_peer {
                                connected = true;
                            }
                        }
                        SwarmEvent::Behaviour(ev) => {
                            match ev {
                                crate::a2a_stream_proto::StreamEvent::Response { request_id, body } => {
                                    if let Some(ch) = pending.remove(&request_id) {
                                        let _ = ch.send(Ok(body));
                                    }
                                }
                                crate::a2a_stream_proto::StreamEvent::Error { request_id, error } => {
                                    if let Some(ch) = pending.remove(&request_id) {
                                        let _ = ch.send(Err(error));
                                    }
                                }
                            }
                        }
                        _ => {}
                    }
                }
            }

            if connected {
                while let Some((request_id, body)) = queue.pop_front() {
                    swarm.behaviour_mut().send(remote_peer, request_id, body);
                }
            }
        }
    });

    Some(tx)
}

#[tokio::main]
async fn main() {
    // Smoke mode for the in-process stream client bridge (no HTTP server).
    if env::var("A2A_STREAM_BRIDGE_SMOKE").ok().as_deref() == Some("1") {
        let p2p_info: Arc<Mutex<serde_json::Value>> = Arc::new(Mutex::new(json!({"enabled": true, "status": "starting_stream_bridge_smoke"})));
        let tx = match start_libp2p_stream_client(p2p_info.clone()).await {
            Some(tx) => tx,
            None => {
                eprintln!("BRIDGE_SMOKE_FAIL start_libp2p_stream_client returned None");
                return;
            }
        };

        let (sx, rx) = oneshot::channel();
        let _ = tx.send(StreamClientCommand { body: "hello".to_string(), resp: sx }).await;

        match tokio::time::timeout(Duration::from_secs(8), rx).await {
            Ok(Ok(Ok(body))) => {
                eprintln!("BRIDGE_SMOKE_OK {body}");
            }
            Ok(Ok(Err(e))) => {
                eprintln!("BRIDGE_SMOKE_ERR {e}");
            }
            Ok(Err(_)) => {
                eprintln!("BRIDGE_SMOKE_ERR oneshot_canceled");
            }
            Err(_) => {
                eprintln!("BRIDGE_SMOKE_ERR timeout");
            }
        }
        return;
    }

    let home = env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    let default_sock = format!("{}/.openclaw/a2a/sidecar.sock", home);
    let sock = env::var("A2A_SOCK").unwrap_or(default_sock);

    let upstream = env::var("A2A_HTTP_SIDECAR_URL").unwrap_or_else(|_| "http://127.0.0.1:17890".to_string());

    if let Some(parent) = Path::new(&sock).parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::remove_file(&sock);

    let p2p_info: Arc<Mutex<serde_json::Value>> = Arc::new(Mutex::new(json!({"enabled": true, "status": "starting"})));
    let p2p_tx = start_libp2p(upstream.clone(), p2p_info.clone()).await;

    // Gated: enable libp2p-stream bridge only when explicitly requested.
    let p2p_stream_tx: Option<StreamClientTx> = if env::var("A2A_LIBP2P_STREAM_ENABLE").ok().as_deref() == Some("1") {
        start_libp2p_stream_client(p2p_info.clone()).await
    } else {
        None
    };

    let upstream_for_service = upstream.clone();
    let sock_for_service = sock.clone();

    let make = make_service_fn(move |_| {
        let upstream = upstream_for_service.clone();
        let sock2 = sock_for_service.clone();
        let p2p_info = p2p_info.clone();
        let p2p_stream_tx = p2p_stream_tx.clone();
        let p2p_tx = p2p_tx.clone();
        async move {
            Ok::<_, Infallible>(service_fn(move |req| {
                handle(req, upstream.clone(), sock2.clone(), p2p_info.clone(), p2p_stream_tx.clone(), p2p_tx.clone())
            }))
        }
    });

    let server = Server::bind_unix(sock.clone()).unwrap().serve(make);

    eprintln!("{}", json!({"ok": true, "event": "A2A_RUST_UDS_LISTENING", "sock": sock, "upstream": upstream}).to_string());

    if let Err(e) = server.await {
        eprintln!("{}", json!({"ok": false, "event": "A2A_RUST_UDS_FATAL", "error": e.to_string()}).to_string());
    }
}
