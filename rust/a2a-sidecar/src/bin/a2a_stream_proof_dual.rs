use libp2p::{identity, Multiaddr, PeerId, Transport, swarm::{Swarm, SwarmEvent}};
use libp2p::futures::StreamExt;

use a2a_sidecar::a2a_stream_behaviour::A2AStreamBehaviour;
use a2a_sidecar::a2a_stream_proto::StreamEvent;

fn strip_p2p(ma: &Multiaddr) -> Multiaddr {
    let mut base = Multiaddr::empty();
    for p in ma.iter() {
        if matches!(p, libp2p::multiaddr::Protocol::P2p(_)) { break; }
        base.push(p);
    }
    base
}

#[tokio::main]
async fn main() {
    // --- server swarm ---
    let server_key = identity::Keypair::generate_ed25519();
    let server_peer = PeerId::from(server_key.public());
    eprintln!("PROOF_SERVER_PEER_ID {server_peer}");

    let server_transport = libp2p::tcp::tokio::Transport::new(libp2p::tcp::Config::default().nodelay(true))
        .upgrade(libp2p::core::upgrade::Version::V1)
        .authenticate(libp2p::noise::Config::new(&server_key).expect("noise"))
        .multiplex(libp2p::yamux::Config::default())
        .boxed();

    let server_behaviour = A2AStreamBehaviour::default();
    let mut server_swarm = Swarm::new(
        server_transport,
        server_behaviour,
        server_peer,
        libp2p::swarm::Config::with_tokio_executor(),
    );

    server_swarm.listen_on("/ip4/127.0.0.1/tcp/0".parse().unwrap()).unwrap();

    let mut server_listen: Option<Multiaddr> = None;

    // --- client swarm ---
    let client_key = identity::Keypair::generate_ed25519();
    let client_peer = PeerId::from(client_key.public());
    eprintln!("PROOF_CLIENT_PEER_ID {client_peer}");

    let client_transport = libp2p::tcp::tokio::Transport::new(libp2p::tcp::Config::default().nodelay(true))
        .upgrade(libp2p::core::upgrade::Version::V1)
        .authenticate(libp2p::noise::Config::new(&client_key).expect("noise"))
        .multiplex(libp2p::yamux::Config::default())
        .boxed();

    let client_behaviour = A2AStreamBehaviour::default();
    let mut client_swarm = Swarm::new(
        client_transport,
        client_behaviour,
        client_peer,
        libp2p::swarm::Config::with_tokio_executor(),
    );

    client_swarm.listen_on("/ip4/127.0.0.1/tcp/0".parse().unwrap()).unwrap();

    let mut dialed = false;
    let mut sent = false;

    loop {
        // Ensure we dial as soon as we know the server listen addr (don't wait for a client event).
        if !dialed {
            if let Some(addr) = server_listen.clone() {
                let remote: Multiaddr = format!("{}/p2p/{server_peer}", addr).parse().unwrap();
                let base = strip_p2p(&remote);
                client_swarm.dial(base).unwrap();
                dialed = true;
                eprintln!("PROOF_CLIENT_DIALING {remote}");
            }
        }

        tokio::select! {
            ev = server_swarm.select_next_some() => {
                match ev {
                    SwarmEvent::NewListenAddr { address, .. } => {
                        if server_listen.is_none() {
                            server_listen = Some(address.clone());
                            let remote = format!("{}/p2p/{server_peer}", address);
                            eprintln!("PROOF_SERVER_LISTENING {remote}");
                        }
                    }
                    SwarmEvent::ConnectionEstablished { peer_id, .. } => {
                        eprintln!("PROOF_SERVER_CONN_ESTABLISHED {peer_id}");
                    }
                    SwarmEvent::Behaviour(ev) => {
                        eprintln!("PROOF_SERVER_BEHAVIOUR_EVENT {ev:?}");
                    }
                    _ => {}
                }
            }

            ev = client_swarm.select_next_some() => {
                // dial once we know server listen
                if !dialed {
                    if let Some(addr) = server_listen.clone() {
                        let remote: Multiaddr = format!("{}/p2p/{server_peer}", addr).parse().unwrap();
                        let base = strip_p2p(&remote);
                        client_swarm.dial(base).unwrap();
                        dialed = true;
                        eprintln!("PROOF_CLIENT_DIALING {remote}");
                    }
                }

                match ev {
                    SwarmEvent::NewListenAddr { address, .. } => {
                        eprintln!("PROOF_CLIENT_LISTENING {address}");
                    }
                    SwarmEvent::ConnectionEstablished { peer_id, .. } => {
                        eprintln!("PROOF_CLIENT_CONN_ESTABLISHED {peer_id}");
                        if !sent && peer_id == server_peer {
                            let request_id = format!("req-{}", chrono::Utc::now().timestamp_millis());
                            client_swarm.behaviour_mut().send(server_peer, request_id.clone(), "hello".to_string());
                            sent = true;
                            eprintln!("PROOF_TRIGGER_SEND {request_id}");
                        }
                    }
                    SwarmEvent::Behaviour(ev) => {
                        eprintln!("PROOF_BEHAVIOUR_EVENT {ev:?}");
                        match ev {
                            StreamEvent::Response { .. } => std::process::exit(0),
                            StreamEvent::Error { .. } => std::process::exit(2),
                        }
                    }
                    _ => {}
                }
            }
        }
    }
}
