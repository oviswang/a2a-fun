use hyper::{Body, Method, Request, Response, Server, StatusCode};
use hyper::service::{make_service_fn, service_fn};
use hyperlocal::UnixServerExt;
use serde_json::json;
use std::convert::Infallible;
use std::env;
use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};

use futures::StreamExt;
use libp2p::{
    identity,
    ping,
    swarm::{Swarm, SwarmEvent},
    Multiaddr, PeerId,
    Transport,
};

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

async fn handle(req: Request<Body>, upstream: String, sock: String, p2p_info: Arc<Mutex<serde_json::Value>>) -> Result<Response<Body>, Infallible> {
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
                return json_response(StatusCode::OK, json!({
                    "ok": false,
                    "error": {"code": "READ_BODY_FAILED"}
                })).await;
            }
            let body_bytes = bytes.unwrap();

            // Phase B skeleton behavior retained: proxy to upstream HTTP sidecar.
            let client = hyper::Client::new();
            let uri: hyper::Uri = match format!("{}/a2a/request", upstream.trim_end_matches('/')).parse() {
                Ok(u) => u,
                Err(_) => {
                    return json_response(StatusCode::OK, json!({
                        "ok": false,
                        "error": {"code": "UPSTREAM_URL_INVALID"}
                    })).await;
                }
            };

            let proxy_req = Request::builder()
                .method(Method::POST)
                .uri(uri)
                .header("content-type", "application/json")
                .body(Body::from(body_bytes))
                .unwrap();

            match client.request(proxy_req).await {
                Ok(mut r) => {
                    let b = hyper::body::to_bytes(r.body_mut()).await.unwrap_or_default();
                    let mut resp = Response::new(Body::from(b));
                    *resp.status_mut() = r.status();
                    resp.headers_mut().insert(hyper::header::CONTENT_TYPE, hyper::header::HeaderValue::from_static("application/json; charset=utf-8"));
                    resp.headers_mut().insert(hyper::header::CACHE_CONTROL, hyper::header::HeaderValue::from_static("no-store"));
                    Ok(resp)
                }
                Err(e) => {
                    json_response(StatusCode::OK, json!({
                        "ok": false,
                        "error": {"code": "UPSTREAM_UNREACHABLE", "message": e.to_string()}
                    })).await
                }
            }
        }
        _ => {
            return json_response(StatusCode::NOT_FOUND, json!({
                "ok": false,
                "error": {"code": "NOT_FOUND"}
            })).await;
        }
    }
}

async fn start_libp2p(p2p_info: Arc<Mutex<serde_json::Value>>) {
    // Phase C bring-up: start a libp2p node and keep its status in p2p_info.
    // This does NOT yet route /a2a/request over libp2p. That will be Phase C2.

    let enable = env::var("A2A_LIBP2P_ENABLE").unwrap_or_else(|_| "1".to_string());
    if enable == "0" || enable.to_lowercase() == "false" {
        *p2p_info.lock().unwrap() = json!({"enabled": false});
        return;
    }

    let key = identity::Keypair::generate_ed25519();
    let peer_id = PeerId::from(key.public());

    let behaviour = ping::Behaviour::new(ping::Config::new());

    // Minimal TCP+Noise+Yamux transport (desktop/server baseline)
    let transport = libp2p::tcp::tokio::Transport::new(libp2p::tcp::Config::default().nodelay(true))
        .upgrade(libp2p::core::upgrade::Version::V1)
        .authenticate(libp2p::noise::Config::new(&key).expect("noise"))
        .multiplex(libp2p::yamux::Config::default())
        .boxed();

    let mut swarm = Swarm::new(
        transport,
        behaviour,
        peer_id,
        libp2p::swarm::Config::with_tokio_executor(),
    );

    // Listen on an ephemeral TCP port (server/desktop baseline).
    // (QUIC etc will be added in Phase C2 when we standardize transports.)
    let listen_addr: Multiaddr = "/ip4/0.0.0.0/tcp/0".parse().expect("listen addr");
    if let Err(e) = swarm.listen_on(listen_addr) {
        *p2p_info.lock().unwrap() = json!({"enabled": true, "peer_id": peer_id.to_string(), "error": format!("{e}")});
        return;
    }

    *p2p_info.lock().unwrap() = json!({
        "enabled": true,
        "peer_id": peer_id.to_string(),
        "listening": []
    });

    while let Some(ev) = swarm.next().await {
        match ev {
            SwarmEvent::NewListenAddr { address, .. } => {
                let mut v = p2p_info.lock().unwrap();
                let mut xs = v.get("listening").and_then(|x| x.as_array()).cloned().unwrap_or_default();
                xs.push(json!(address.to_string()));
                *v = json!({
                    "enabled": true,
                    "peer_id": peer_id.to_string(),
                    "listening": xs
                });
            }
            _ => {}
        }
    }
}

#[tokio::main]
async fn main() {
    // Phase B skeleton:
    // - Serve HTTP over Unix socket.
    // - Proxy /a2a/request to upstream HTTP sidecar.
    // Phase C (this commit):
    // - Bring up a libp2p node (status visible in /healthz), without changing request routing yet.

    let home = env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    let default_sock = format!("{}/.openclaw/a2a/sidecar.sock", home);
    let sock = env::var("A2A_SOCK").unwrap_or(default_sock);

    let upstream = env::var("A2A_HTTP_SIDECAR_URL").unwrap_or_else(|_| "http://127.0.0.1:17890".to_string());

    if let Some(parent) = Path::new(&sock).parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::remove_file(&sock);

    let p2p_info: Arc<Mutex<serde_json::Value>> = Arc::new(Mutex::new(json!({"enabled": true, "status": "starting"})));
    tokio::spawn(start_libp2p(p2p_info.clone()));

    let upstream_for_service = upstream.clone();
    let sock_for_service = sock.clone();

    let make = make_service_fn(move |_| {
        let upstream = upstream_for_service.clone();
        let sock2 = sock_for_service.clone();
        let p2p_info = p2p_info.clone();
        async move {
            Ok::<_, Infallible>(service_fn(move |req| {
                handle(req, upstream.clone(), sock2.clone(), p2p_info.clone())
            }))
        }
    });

    let server = Server::bind_unix(sock.clone()).unwrap().serve(make);

    eprintln!("{}", json!({"ok": true, "event": "A2A_RUST_UDS_LISTENING", "sock": sock, "upstream": upstream}).to_string());

    if let Err(e) = server.await {
        eprintln!("{}", json!({"ok": false, "event": "A2A_RUST_UDS_FATAL", "error": e.to_string()}).to_string());
    }
}
