"""Restrict yt-dlp's own HTTPS connections, including redirects, to provider networks."""
import ipaddress
import os
import socket

hosts = tuple(os.environ.get("LINKORA_EGRESS_HOSTS", "").split(","))
exact_hosts = os.environ.get("LINKORA_EXACT_HOSTS") == "1"
resolve = socket.getaddrinfo
connect = socket.socket.connect

def public(value):
    address = ipaddress.ip_address(value)
    return address.is_global and not address.is_multicast and not getattr(address, "ipv4_mapped", None)

def guarded_lookup(host, port, *args, **kwargs):
    name = str(host).lower().rstrip(".")
    if str(port) != "443" or not any(h and (name == h or (not exact_hosts and name.endswith("." + h))) for h in hosts):
        raise OSError("Destination outside provider network")
    results = resolve(host, port, *args, **kwargs)
    if not results or not all(public(r[4][0]) for r in results):
        raise OSError("Non-public destination")
    return results

def guarded_connect(sock, addr):
    if not isinstance(addr, tuple) or addr[1] != 443 or not public(addr[0]):
        raise OSError("Invalid outgoing connection")
    return connect(sock, addr)

socket.getaddrinfo = guarded_lookup
socket.socket.connect = guarded_connect
import resource
cap = int(os.environ["LINKORA_MAX_BYTES"])
resource.setrlimit(resource.RLIMIT_FSIZE, (cap, cap))
from yt_dlp import main
main()
