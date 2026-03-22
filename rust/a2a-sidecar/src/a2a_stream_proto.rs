//! Scheme A: custom libp2p substream protocol for A2A sidecar.
//!
//! Protocol: /a2a/sidecar/stream/0.1
//! Framing: u32 (big-endian) length prefix + JSON bytes
//!
//! Step 3.1 scope: define the wire protocol types + framing helpers and a compile-ready
//! scaffold for the behaviour/handler implementation.

use serde::{Deserialize, Serialize};
use std::io;
use std::env;

fn stream_debug() -> bool {
    env::var("A2A_STREAM_DEBUG").ok().as_deref() == Some("1")
}

use futures::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use libp2p::swarm::StreamProtocol;

pub const A2A_STREAM_PROTO_STR: &str = "/a2a/sidecar/stream/0.1";

pub fn a2a_stream_protocol() -> StreamProtocol {
    StreamProtocol::new(A2A_STREAM_PROTO_STR)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamRequest {
    pub request_id: String,
    /// Raw JSON string body of POST /a2a/request
    pub body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamResponse {
    pub request_id: String,
    /// Raw JSON string body to return to the HTTP caller
    pub body: String,
    /// Optional error string (for debugging)
    pub error: Option<String>,
}

pub async fn write_frame<W: AsyncWrite + Unpin>(io: &mut W, bytes: &[u8]) -> io::Result<()> {
    let len: u32 = bytes
        .len()
        .try_into()
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "frame too large"))?;
    io.write_all(&len.to_be_bytes()).await?;
    io.write_all(bytes).await?;
    io.flush().await?;
    Ok(())
}

pub async fn read_frame<R: AsyncRead + Unpin>(io: &mut R) -> io::Result<Vec<u8>> {
    let mut len_buf = [0u8; 4];
    io.read_exact(&mut len_buf).await?;
    let len = u32::from_be_bytes(len_buf) as usize;
    let mut buf = vec![0u8; len];
    io.read_exact(&mut buf).await?;
    Ok(buf)
}

pub async fn write_json_frame<W: AsyncWrite + Unpin, T: Serialize>(io: &mut W, v: &T) -> io::Result<()> {
    let data = serde_json::to_vec(v).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e.to_string()))?;
    write_frame(io, &data).await
}

pub async fn read_json_frame<R: AsyncRead + Unpin, T: for<'de> Deserialize<'de>>(io: &mut R) -> io::Result<T> {
    let data = read_frame(io).await?;
    serde_json::from_slice(&data).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e.to_string()))
}

// ---
// Step 3.1-b: compile-ready ConnectionHandler scaffold.
//
// This is intentionally a minimal placeholder that compiles. In Step 3.2 we will
// replace DeniedUpgrade with real inbound/outbound upgrades for A2A_STREAM_PROTO_STR,
// wire it into a NetworkBehaviour, and drive it from the HTTP handler.
// ---

use std::{collections::VecDeque, task::{Context, Poll}};
use libp2p_core::upgrade::ReadyUpgrade;
use libp2p_swarm::handler::{
    ConnectionEvent, ConnectionHandler, ConnectionHandlerEvent, SubstreamProtocol,
    FullyNegotiatedInbound, FullyNegotiatedOutbound,
};
use tokio::sync::mpsc;

#[derive(Debug, Clone)]
pub struct OutboundOpenInfo {
    pub request_id: String,
    pub body: String,
}

#[derive(Debug, Clone)]
pub enum StreamCommand {
    Send { request_id: String, body: String },
}

#[derive(Debug, Clone)]
pub enum StreamEvent {
    Response { request_id: String, body: String },
    Error { request_id: String, error: String },
}

#[derive(Debug)]
pub struct A2AStreamHandler {
    pending: VecDeque<OutboundOpenInfo>,
    tx: mpsc::UnboundedSender<StreamEvent>,
    rx: mpsc::UnboundedReceiver<StreamEvent>,
    poll_count: u64,
}

impl Default for A2AStreamHandler {
    fn default() -> Self {
        let (tx, rx) = mpsc::unbounded_channel();
        Self {
            pending: VecDeque::new(),
            tx,
            rx,
            poll_count: 0,
        }
    }
}

impl A2AStreamHandler {
    fn proto(&self) -> ReadyUpgrade<StreamProtocol> {
        ReadyUpgrade::new(a2a_stream_protocol())
    }
}

impl ConnectionHandler for A2AStreamHandler {
    type FromBehaviour = StreamCommand;
    type ToBehaviour = StreamEvent;

    type InboundProtocol = ReadyUpgrade<StreamProtocol>;
    type OutboundProtocol = ReadyUpgrade<StreamProtocol>;

    type InboundOpenInfo = ();
    type OutboundOpenInfo = OutboundOpenInfo;

    fn listen_protocol(&self) -> SubstreamProtocol<Self::InboundProtocol, Self::InboundOpenInfo> {
        if stream_debug() { eprintln!("STREAM_LISTEN_PROTOCOL {}", A2A_STREAM_PROTO_STR); }
        SubstreamProtocol::new(self.proto(), ())
    }

    fn connection_keep_alive(&self) -> bool {
        // Proof mode: keep connections alive to observe follow-up substream events.
        true
    }

    fn on_behaviour_event(&mut self, event: Self::FromBehaviour) {
        match event {
            StreamCommand::Send { request_id, body } => {
                eprintln!("STREAM_HANDLER_GOT_COMMAND {request_id}");
                self.pending.push_back(OutboundOpenInfo { request_id, body });
            }
        }
    }

    fn on_connection_event(
        &mut self,
        event: ConnectionEvent<
            Self::InboundProtocol,
            Self::OutboundProtocol,
            Self::InboundOpenInfo,
            Self::OutboundOpenInfo,
        >,
    ) {
        let ev_dbg = format!("{event:?}");
        if stream_debug() { eprintln!("STREAM_CONN_EVENT {ev_dbg}"); }
        match event {
            ConnectionEvent::FullyNegotiatedInbound(FullyNegotiatedInbound { protocol: mut stream, .. }) => {
                let tx = self.tx.clone();
                tokio::spawn(async move {
                    eprintln!("STREAM_INBOUND_ACCEPTED");
                    let req: StreamRequest = match read_json_frame(&mut stream).await {
                        Ok(r) => r,
                        Err(e) => {
                            let _ = tx.send(StreamEvent::Error { request_id: "inbound".to_string(), error: format!("read_request:{e}") });
                            return;
                        }
                    };
                    eprintln!("STREAM_INBOUND_READ_REQUEST {}", req.request_id);

                    let resp = StreamResponse {
                        request_id: req.request_id.clone(),
                        body: req.body.clone(),
                        error: None,
                    };

                    if let Err(e) = write_json_frame(&mut stream, &resp).await {
                        let _ = tx.send(StreamEvent::Error { request_id: resp.request_id.clone(), error: format!("write_response:{e}") });
                        return;
                    }
                    eprintln!("STREAM_INBOUND_WROTE_RESPONSE {}", resp.request_id);
                });
            }

            ConnectionEvent::FullyNegotiatedOutbound(FullyNegotiatedOutbound { protocol: mut stream, info }) => {
                let tx = self.tx.clone();
                tokio::spawn(async move {
                    eprintln!("STREAM_OUTBOUND_OPEN {}", info.request_id);

                    let req = StreamRequest { request_id: info.request_id.clone(), body: info.body.clone() };
                    if let Err(e) = write_json_frame(&mut stream, &req).await {
                        let _ = tx.send(StreamEvent::Error { request_id: info.request_id.clone(), error: format!("write_request:{e}") });
                        return;
                    }
                    eprintln!("STREAM_OUTBOUND_WROTE_REQUEST {}", info.request_id);

                    let resp: StreamResponse = match read_json_frame(&mut stream).await {
                        Ok(r) => r,
                        Err(e) => {
                            let _ = tx.send(StreamEvent::Error { request_id: info.request_id.clone(), error: format!("read_response:{e}") });
                            return;
                        }
                    };
                    eprintln!("STREAM_OUTBOUND_READ_RESPONSE {}", resp.request_id);

                    let _ = tx.send(StreamEvent::Response { request_id: resp.request_id, body: resp.body });
                });
            }

            ConnectionEvent::DialUpgradeError(e) => {
                // Outbound upgrade failed; we have access to OutboundOpenInfo (incl request_id).
                eprintln!("STREAM_DIAL_UPGRADE_ERROR request_id={} err={:?}", e.info.request_id, e.error);
                let _ = self.tx.send(StreamEvent::Error { request_id: e.info.request_id.clone(), error: format!("DIAL_UPGRADE_ERROR:{:?}", e.error) });
            }
            ConnectionEvent::ListenUpgradeError(e) => {
                eprintln!("STREAM_LISTEN_UPGRADE_ERROR err={:?}", e);
                let _ = self.tx.send(StreamEvent::Error { request_id: "listen".to_string(), error: format!("LISTEN_UPGRADE_ERROR:{e:?}") });
            }
            _ => {}
        }
    }

    fn poll(
        &mut self,
        _cx: &mut Context<'_>,
    ) -> Poll<ConnectionHandlerEvent<Self::OutboundProtocol, Self::OutboundOpenInfo, Self::ToBehaviour>> {
        self.poll_count += 1;
        if stream_debug() && self.poll_count <= 50 {
            eprintln!("STREAM_HANDLER_POLL {}", self.poll_count);
        }
        // Drain events from async tasks.
        while let Ok(ev) = self.rx.try_recv() {
            return Poll::Ready(ConnectionHandlerEvent::NotifyBehaviour(ev));
        }

        // Request an outbound substream if pending exists.
        if let Some(info) = self.pending.pop_front() {
            eprintln!("STREAM_OUTBOUND_PROTOCOL {}", A2A_STREAM_PROTO_STR);
            eprintln!("STREAM_HANDLER_REQUEST_OUTBOUND {}", info.request_id);
            let proto = SubstreamProtocol::new(self.proto(), info);
            return Poll::Ready(ConnectionHandlerEvent::OutboundSubstreamRequest { protocol: proto });
        }

        Poll::Pending
    }
}
