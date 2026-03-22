use std::env;

use libp2p::futures::StreamExt;

use libp2p::{
    identity, Multiaddr, PeerId,
    swarm::{Swarm, SwarmEvent},
    Transport,
};

use a2a_sidecar::a2a_stream_behaviour::A2AStreamBehaviour;

fn peer_id_from_multiaddr(ma: &Multiaddr) -> Option<PeerId> {
    for p in ma.iter() {
        if let libp2p::multiaddr::Protocol::P2p(pid) = p {
            return Some(pid);
        }
    }
    None
}

#[tokio::main]
async fn main() {
    let role = env::var("A2A_STREAM_PROOF_ROLE").unwrap_or_else(|_| "server".to_string());
    let listen_addr: Multiaddr = env::var("A2A_LIBP2P_LISTEN_ADDR")
        .unwrap_or_else(|_| "/ip4/127.0.0.1/tcp/0".to_string())
        .parse()
        .expect("listen addr");

    let remote = env::var("A2A_LIBP2P_REMOTE_ADDR").ok().and_then(|s| s.parse::<Multiaddr>().ok());

    let key = identity::Keypair::generate_ed25519();
    let peer_id = PeerId::from(key.public());
    eprintln!("PROOF_PEER_ID {peer_id}");

    let transport = libp2p::tcp::tokio::Transport::new(libp2p::tcp::Config::default().nodelay(true))
        .upgrade(libp2p::core::upgrade::Version::V1)
        .authenticate(libp2p::noise::Config::new(&key).expect("noise"))
        .multiplex(libp2p::yamux::Config::default())
        .boxed();

    let behaviour = A2AStreamBehaviour::default();

    let mut swarm = Swarm::new(
        transport,
        behaviour,
        peer_id,
        libp2p::swarm::Config::with_tokio_executor(),
    );

    swarm.listen_on(listen_addr).expect("listen_on");

    if role == "client" {
        let remote = remote.expect("A2A_LIBP2P_REMOTE_ADDR required for client");
        let pid = peer_id_from_multiaddr(&remote).expect("remote peer id in multiaddr");

        // Dial the base addr (strip /p2p)
        let mut base = Multiaddr::empty();
        for p in remote.iter() {
            if matches!(p, libp2p::multiaddr::Protocol::P2p(_)) { break; }
            base.push(p);
        }

        swarm.dial(base).expect("dial");

        // After connection established, behaviour will be told to send.
        let mut sent = false;

        loop {
            match swarm.select_next_some().await {
                SwarmEvent::NewListenAddr { address, .. } => {
                    eprintln!("PROOF_LISTENING {address}");
                }
                SwarmEvent::ConnectionEstablished { peer_id, .. } => {
                    eprintln!("PROOF_CONN_ESTABLISHED {peer_id}");
                    if !sent && peer_id == pid {
                        let request_id = format!("req-{}", chrono::Utc::now().timestamp_millis());
                        swarm.behaviour_mut().send(pid, request_id.clone(), "hello".to_string());
                        sent = true;
                        eprintln!("PROOF_TRIGGER_SEND {request_id}");
                    }
                }
                SwarmEvent::Behaviour(ev) => {
                    // This is the key evidence: handler -> behaviour event.
                    eprintln!("PROOF_BEHAVIOUR_EVENT {ev:?}");
                    // Exit after first response.
                    std::process::exit(0);
                }
                _ => {}
            }
        }
    } else {
        // server mode: just run and show behaviour events if any
        loop {
            match swarm.select_next_some().await {
                SwarmEvent::NewListenAddr { address, .. } => {
                    eprintln!("PROOF_LISTENING {address}");
                }
                SwarmEvent::ConnectionEstablished { peer_id, .. } => {
                    eprintln!("PROOF_CONN_ESTABLISHED {peer_id}");
                }
                SwarmEvent::Behaviour(ev) => {
                    eprintln!("PROOF_BEHAVIOUR_EVENT {ev:?}");
                }
                _ => {}
            }
        }
    }
}
