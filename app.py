from flask import Flask, jsonify, request, send_file
from flask_cors import CORS
import sys, os, json, time, smtplib, pandas as pd
from email.message import EmailMessage
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter, landscape
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from reportlab.lib.styles import getSampleStyleSheet

# Link custom scanner script
sys.path.append(os.path.join(os.path.dirname(__file__), '..', 'scanner'))
from scanner import scan_network

app = Flask(__name__)
CORS(app)

# Ensure reports directory exists
def get_reports_dir():
    d = os.path.join(os.path.dirname(__file__), '..', 'reports')
    os.makedirs(d, exist_ok=True)
    return d

# Trigger network scan
@app.route('/api/scan')
def scan():
    target = request.args.get('range')
    return jsonify({"devices": scan_network(target) if target else scan_network()})

# Retrieve last saved network data
@app.route('/api/devices')
def get_devices():
    path = os.path.join(get_reports_dir(), 'devices.json')
    if os.path.exists(path):
        with open(path) as f: return jsonify(json.load(f))
    return jsonify([])

# Process ticketing system submissions
@app.route('/api/complaint', methods=['POST'])
def submit_complaint():
    data = request.json
    timestamp = time.strftime('%Y-%m-%d %H:%M:%S')
    tech_name = data.get('technician', 'Unknown User')
    
    # Email bug report directly to developer
    if data.get('type') == 'system_bug':
        SENDER_EMAIL = "leboko.it@gmail.com"
        SENDER_APP_PASSWORD = "pnpz jqae nfvk sxai" 
        RECEIVER_EMAIL = "leboko.it@gmail.com"
        
        try:
            msg = EmailMessage()
            msg.set_content(f"SYSTEM BUG REPORT:\n\nBy: {tech_name}\nTime: {timestamp}\n\nIssue:\n{data['issue']}")
            msg['Subject'] = f"UI Bug Report from {tech_name}"
            msg['From'], msg['To'] = f"Dashboard <{SENDER_EMAIL}>", RECEIVER_EMAIL

            with smtplib.SMTP_SSL('smtp.gmail.com', 465) as server:
                server.login(SENDER_EMAIL, SENDER_APP_PASSWORD)
                server.send_message(msg)
                
            return jsonify({"status": "success", "message": "Feedback emailed!"})
        except Exception as e:
            print("Email failed.", e)
            return jsonify({"status": "error", "message": "Email failed."})

    # Save device ticket to local JSON
    else:
        data['timestamp'] = timestamp
        path = os.path.join(get_reports_dir(), 'complaints.json')
        complaints = []
        if os.path.exists(path):
            with open(path, 'r') as f:
                try: complaints = json.load(f)
                except: pass
                
        complaints.append(data)
        with open(path, 'w') as f:
            json.dump(complaints, f, indent=2)
            
        return jsonify({"status": "success", "message": "Complaint recorded locally!"})

# Export network data to desired file format
@app.route('/api/export')
def export_data():
    fmt = request.args.get('format', 'json').lower()
    reports_dir = get_reports_dir()
    json_path = os.path.join(reports_dir, 'devices.json')

    if not os.path.exists(json_path): return jsonify({"error": "No scan data available"}), 404
    with open(json_path, 'r') as f: devices = json.load(f)
    devices = devices.get("devices", [devices]) if isinstance(devices, dict) else devices if isinstance(devices, list) else []
    timestamp = time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(os.path.getmtime(json_path)))

    if fmt == 'json':
        return send_file(json_path, as_attachment=True, download_name='network_report.json')

    elif fmt == 'csv':
        csv_path = os.path.join(reports_dir, 'devices.csv')
        df = pd.DataFrame(devices)
        if 'open_ports' in df.columns: df['open_ports'] = df['open_ports'].apply(lambda x: ', '.join(map(str, x)) if isinstance(x, list) and x else 'None')
        cols = ['ip', 'hostname', 'mac', 'vendor', 'latency', 'open_ports', 'status']
        df = df[[c for c in cols if c in df.columns]]
        df.columns = ['IP Address', 'Hostname', 'MAC Address', 'Vendor', 'Latency', 'Open Ports', 'Status']
        df.to_csv(csv_path, index=False)
        return send_file(csv_path, as_attachment=True, download_name='network_report.csv')

    elif fmt == 'pdf':
        pdf_path = os.path.join(reports_dir, 'devices.pdf')
        doc = SimpleDocTemplate(pdf_path, pagesize=landscape(letter))
        elements = [
            Paragraph("Network Discovery Report", getSampleStyleSheet()['Title']),
            Spacer(1, 6), Paragraph(f"Scan time: {timestamp} | Devices: {len(devices)}", getSampleStyleSheet()['Normal']), Spacer(1, 12)
        ]
        
        data = [["IP Address", "Hostname", "MAC", "Vendor", "Latency", "Ports", "Status"]]
        for d in devices:
            data.append([d.get("ip", ""), d.get("hostname", "Unknown"), d.get("mac", ""), d.get("vendor", "Unknown"), str(d.get("latency", "N/A")), ", ".join(map(str, d.get("open_ports", []))) or "None", d.get("status", "online")])
            
        t = Table(data, colWidths=[90, 100, 110, 80, 60, 100, 50])
        t.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#6c2bd9')), ('TEXTCOLOR', (0,0), (-1,0), colors.whitesmoke),
            ('ALIGN', (0,0), (-1,-1), 'CENTER'), ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
            ('BOTTOMPADDING', (0,0), (-1,0), 12), ('BACKGROUND', (0,1), (-1,-1), colors.HexColor('#f9f9f9')),
            ('GRID', (0,0), (-1,-1), 1, colors.HexColor('#cccccc')), ('FONTSIZE', (0,0), (-1,-1), 9)
        ]))
        elements.append(t)
        doc.build(elements)
        return send_file(pdf_path, as_attachment=True, download_name='network_report.pdf')

    elif fmt == 'pcap':
        return send_file(os.path.join(reports_dir, 'scan_traffic.pcap'), as_attachment=True, download_name='raw_traffic.pcap')

if __name__ == '__main__':
    app.run(debug=True, port=5000)