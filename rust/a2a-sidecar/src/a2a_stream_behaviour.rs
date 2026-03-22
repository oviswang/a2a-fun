//! Minimal NetworkBehaviour wrapper for Scheme A stream protocol.
//!
//! Scope: proof-oriented.
//! - Uses A2AStreamHandler as the connection handler.
//! - Surfaces StreamEvent as SwarmEvent::Behaviour(...).
//! - Provides a minimal method to trigger StreamCommand::Send to a peer handler.

use std::{collections::{HashMap, VecDeque}, task::{Context, Poll}};
use std::env;

fn stream_debug() -> bool {
    env::var("A2A_STREAM_DEBUG").ok().as_deref() == Some("1")
}

use libp2p::{Multiaddr, PeerId};
use libp2p_swarm::{
    ConnectionDenied, FromSwarm, NetworkBehaviour, ToSwarm,
    ConnectionId, THandler, THandlerInEvent, THandlerOutEvent,
};
use libp2p_core::connection::Endpoint;

use crate::a2a_stream_proto::{A2AStreamHandler, StreamCommand, StreamEvent};

pub struct A2AStreamBehaviour {
    pending: VecDeque<(PeerId, StreamCommand)>,
    out: VecDeque<StreamEvent>,
    conns: HashMap<PeerId, ConnectionId>,
}

impl Default for A2AStreamBehaviour {
    fn default() -> Self {
        Self { pending: VecDeque::new(), out: VecDeque::new(), conns: HashMap::new() }
    }
}

impl A2AStreamBehaviour {
    pub fn send(&mut self, peer_id: PeerId, request_id: String, body: String) {
        self.pending.push_back((peer_id, StreamCommand::Send { request_id, body }));
    }
}

impl NetworkBehaviour for A2AStreamBehaviour {
    type ConnectionHandler = A2AStreamHandler;
    type ToSwarm = StreamEvent;

    fn handle_established_inbound_connection(
        &mut self,
        connection_id: ConnectionId,
        peer: PeerId,
        _local_addr: &Multiaddr,
        _remote_addr: &Multiaddr,
    ) -> Result<THandler<Self>, ConnectionDenied> {
        if stream_debug() { eprintln!("PROOF_HANDLER_CREATED inbound peer={peer} conn={connection_id}"); }
        self.conns.insert(peer, connection_id);
        Ok(A2AStreamHandler::default())
    }

    fn handle_established_outbound_connection(
        &mut self,
        connection_id: ConnectionId,
        peer: PeerId,
        _addr: &Multiaddr,
        _role_override: Endpoint,
    ) -> Result<THandler<Self>, ConnectionDenied> {
        if stream_debug() { eprintln!("PROOF_HANDLER_CREATED outbound peer={peer} conn={connection_id}"); }
        self.conns.insert(peer, connection_id);
        Ok(A2AStreamHandler::default())
    }

    fn on_swarm_event(&mut self, _event: FromSwarm) {}

    fn on_connection_handler_event(
        &mut self,
        _peer_id: PeerId,
        _connection_id: ConnectionId,
        event: THandlerOutEvent<Self>,
    ) {
        // Surface handler events as behaviour events.
        self.out.push_back(event);
    }

    fn poll(&mut self, _cx: &mut Context<'_>) -> Poll<ToSwarm<Self::ToSwarm, THandlerInEvent<Self>>> {
        if let Some(ev) = self.out.pop_front() {
            return Poll::Ready(ToSwarm::GenerateEvent(ev));
        }

        if let Some((peer_id, cmd)) = self.pending.pop_front() {
            if stream_debug() {
                let StreamCommand::Send { request_id, .. } = &cmd;
                eprintln!("PROOF_NOTIFY_HANDLER_SENT {peer_id} {request_id}");
            }
            // Use Any (proven delivery). Do not use One(connection_id) here.
            return Poll::Ready(ToSwarm::NotifyHandler {
                peer_id,
                handler: libp2p_swarm::behaviour::NotifyHandler::Any,
                event: cmd,
            });
        }

        Poll::Pending
    }
}
