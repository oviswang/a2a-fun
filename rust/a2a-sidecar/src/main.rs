use hyper::{Body, Method, Request, Response, Server, StatusCode};
use hyper::service::{make_service_fn, service_fn};
use hyperlocal::UnixServerExt;
use serde_json::json;
use std::convert::Infallible;
use std::env;
use std::fs;
use std::path::Path;

fn now_iso() -> String {
    // good enough for PoC
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

async fn handle(req: Request<Body>, upstream: String, sock: String) -> Result<Response<Body>, Infallible> {
    match (req.method(), req.uri().path()) {
        (&Method::GET, "/healthz") => {
            return json_response(StatusCode::OK, json!({
                "ok": true,
                "ts": now_iso(),
                "sock": sock,
                "upstream": upstream
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

            // Proxy to upstream HTTP sidecar for Phase B skeleton.
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
                    // passthrough response body
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

#[tokio::main]
async fn main() {
    // Phase B skeleton:
    // - Serve HTTP over Unix socket.
    // - Proxy to upstream HTTP sidecar.

    let home = env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    let default_sock = format!("{}/.openclaw/a2a/sidecar.sock", home);
    let sock = env::var("A2A_SOCK").unwrap_or(default_sock);

    let upstream = env::var("A2A_HTTP_SIDECAR_URL").unwrap_or_else(|_| "http://127.0.0.1:17890".to_string());

    // ensure parent exists
    if let Some(parent) = Path::new(&sock).parent() {
        let _ = fs::create_dir_all(parent);
    }
    // cleanup existing
    let _ = fs::remove_file(&sock);

    let upstream_for_service = upstream.clone();
    let sock_for_service = sock.clone();

    let make = make_service_fn(move |_| {
        let upstream = upstream_for_service.clone();
        let sock2 = sock_for_service.clone();
        async move {
            Ok::<_, Infallible>(service_fn(move |req| {
                handle(req, upstream.clone(), sock2.clone())
            }))
        }
    });

    let server = Server::bind_unix(sock.clone()).unwrap().serve(make);

    eprintln!("{}", json!({"ok": true, "event": "A2A_RUST_UDS_LISTENING", "sock": sock, "upstream": upstream}).to_string());

    if let Err(e) = server.await {
        eprintln!("{}", json!({"ok": false, "event": "A2A_RUST_UDS_FATAL", "error": e.to_string()}).to_string());
    }
}
