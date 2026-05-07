from scapy.all import ARP, Ether, srp, IP, ICMP, sr1, sniff, wrpcap
import psutil, json, os, socket, time, random, concurrent.futures

# Grabs the readable computer name if it has one (like 'User-PC')
def get_hostname(ip):
    try: return socket.gethostbyaddr(ip)[0]
    except socket.herror: return "Unknown"

# Matches the first half of the MAC address to a known manufacturer
def get_vendor(mac):
    vendors = {"00:50:56": "VMware", "08:00:27": "VirtualBox", "00:1A:2B": "Cisco", 
               "DC:A9:04": "Apple", "B8:27:EB": "Raspberry Pi", "00:14:22": "Dell"}
    return vendors.get(mac.upper()[:8], "Unknown Vendor")

# Pings the device to see how fast it responds
def get_latency(ip):
    start = time.time()
    return f"{round((time.time() - start) * 1000, 2)} ms" if sr1(IP(dst=ip)/ICMP(), timeout=0.5, verbose=False) else "Timeout"

# Finds the IP of the machine actually running this script
def get_local_ip():
    for interface, addrs in psutil.net_if_addrs().items():
        for addr in addrs:
            if addr.family == 2 and not addr.address.startswith("127"): return addr.address
    return None

# Checks standard security ports incredibly fast using multi-threading
def scan_ports(ip):
    open_ports = []
    def check_port(port):
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(0.3)
        if sock.connect_ex((ip, port)) == 0: open_ports.append(port)
        sock.close()

    # Spin up 5 threads to check all ports at the exact same time
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
        executor.map(check_port, [22, 23, 80, 443, 3389])
    return open_ports

# The main brain of the operation
def scan_network(target=None):
    # Setup our save folders
    reports_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "reports")
    os.makedirs(reports_dir, exist_ok=True)
    save_path, pcap_path = os.path.join(reports_dir, "devices.json"), os.path.join(reports_dir, "scan_traffic.pcap")

    # --- SIMULATION MODE ---
    if target and target.strip().lower() == "simulate":
        print("Running in simulation mode...")
        
        # Start with our fake Core Router
        mock_devices = [{
            "ip": "192.168.1.1", "mac": "00:1A:2B:33:44:55", "hostname": "Core-Gateway", 
            "vendor": "Cisco", "latency": "1.2 ms", "status": "online", 
            "traffic_count": 850, "is_top_talker": True, "open_ports": [22, 80, 443]
        }]
        
        vendors, prefixes = ["Apple", "Samsung", "Dell", "HP", "Lenovo", "Sony"], ["User-Laptop", "Lab-Desktop", "IoT-Sensor"]
        port_options = [[80, 443], [22], [23, 80], [3389], [], [443], []]

        # Rapidly generate 40 fake devices using a loop
        for i in range(2, 42):
            is_timeout = random.random() > 0.9 
            mock_devices.append({
                "ip": f"192.168.1.{i}", 
                "mac": ":".join(["%02x" % random.randint(0, 255) for _ in range(6)]),
                "hostname": f"{random.choice(prefixes)}-{i}", 
                "vendor": random.choice(vendors),
                "latency": "Timeout" if is_timeout else f"{random.randint(5, 120)} ms", 
                "status": "offline" if is_timeout else "online",
                "traffic_count": random.randint(5, 150), 
                "is_top_talker": False, "open_ports": random.choice(port_options)
            })
            
        with open(save_path, "w") as f: json.dump(mock_devices, f, indent=2)
        return mock_devices

    # --- REAL SCANNER MODE ---
    network = target or (".".join(get_local_ip().split(".")[:3]) + ".0/24" if get_local_ip() else None)
    if not network: return []

    print(f"Scanning {network}...")
    result = srp(Ether(dst="ff:ff:ff:ff:ff:ff")/ARP(pdst=network), timeout=2, verbose=False)[0]

    # Unpack the Scapy results
    devices = [{"ip": r.psrc, "mac": r.hwsrc, "hostname": get_hostname(r.psrc), "vendor": get_vendor(r.hwsrc), 
                "latency": get_latency(r.psrc), "status": "online", "traffic_count": 0, "open_ports": scan_ports(r.psrc)} 
               for s, r in result]
    
    active_ips = [d["ip"] for d in devices]
    if packets := [r for s, r in result]: wrpcap(pcap_path, packets) # Save PCAP if we have data

    # Sniff network to figure out who is downloading/uploading the most
    print("Sniffing network for 3 seconds to determine Top Talker...")
    traffic_counts = {}
    for pkt in sniff(timeout=3):
        if IP in pkt and pkt[IP].src in active_ips:
            traffic_counts[pkt[IP].src] = traffic_counts.get(pkt[IP].src, 0) + 1

    top_talker = max(traffic_counts, key=traffic_counts.get) if traffic_counts else None

    # Update devices with their final traffic scores
    for d in devices:
        d["traffic_count"] = traffic_counts.get(d["ip"], 0)
        d["is_top_talker"] = (d["ip"] == top_talker)

    with open(save_path, "w") as f: json.dump(devices, f, indent=2)
    return devices

if __name__ == "__main__":
    print(json.dumps(scan_network(), indent=2))