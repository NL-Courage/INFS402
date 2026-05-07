import { useState, useEffect, useRef } from 'react';

const T = {
  light: { bg: '#f5f5f5', card: '#ffffff', border: '#cccccc', text: '#1a1a2e', subtext: '#888888', tableBg1: '#f9f9f9', tableBg2: '#ffffff', mapBg: '#f9f9f9' },
  dark:  { bg: '#0d0d0d', card: '#1a0533', border: '#6c2bd9', text: '#ffffff', subtext: '#aaaaaa', tableBg1: '#1a0533', tableBg2: '#2d1052', mapBg: '#1a0533' }
};
const PURPLE = '#6c2bd9', DARK_PURPLE = '#1a0533', ACC = '#a855f7';

export default function App() {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [scanRange, setScanRange] = useState('');
  const [lastScan, setLastScan] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [dark, setDark] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  
  const [reportingDevice, setReportingDevice] = useState(null); 
  const [complaintText, setComplaintText] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [techName, setTechName] = useState('');

  const mapRef = useRef(null);
  const networkRef = useRef(null);
  const C = dark ? T.dark : T.light; 

  // Calculate executive security score based on network risks
  const getSecurityScore = () => {
    if (!devices.length) return { score: 100, grade: 'A', color: '#10b981' }; 
    const offline = devices.filter(d => d.latency === 'Timeout').length / devices.length;
    const risky = devices.filter(d => d.open_ports?.some(p => [22, 23, 3389].includes(p))).length / devices.length;
    const score = Math.max(0, 100 - Math.round(offline * 30) - Math.round(risky * 70));
    const [grade, color] = score >= 90 ? ['A', '#10b981'] : score >= 80 ? ['B', '#84cc16'] : score >= 70 ? ['C', '#f59e0b'] : ['D', '#f97316'];
    return { score, grade, color };
  };

  // Fetch network data and update dashboard state
  const runApiRequest = (url, isNewScan = false) => {
    setLoading(true);
    if (isNewScan) setDevices([]); 
    fetch(url).then(r => r.json()).then(d => {
      setDevices(Array.isArray(d) ? d : (d.devices || []));
      if (isNewScan) setLastScan(new Date().toLocaleString());
      setLoading(false);
    }).catch(err => { console.error(err); setDevices([]); setLoading(false); });
  };

  // Save a local ticket about a specific network device
  const submitDeviceTicket = () => {
    if (!complaintText || !techName) return alert("Please fill out both fields.");
    fetch('http://127.0.0.1:5000/api/complaint', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'device_issue', ip: reportingDevice.ip, mac: reportingDevice.mac, issue: complaintText, technician: techName })
    }).then(() => {
      alert("Local Ticket Saved to System!");
      setReportingDevice(null); setComplaintText(''); setTechName('');     
    }).catch(err => console.error(err));
  };

  // Email developer directly about a dashboard bug
  const submitSystemFeedback = () => {
    if (!feedbackText || !techName) return alert("Please fill out both fields.");
    fetch('http://127.0.0.1:5000/api/complaint', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'system_bug', issue: feedbackText, technician: techName })
    }).then(() => {
      alert("Bug Report Sent to Developer Email!");
      setShowFeedback(false); setFeedbackText(''); setTechName('');     
    }).catch(err => console.error(err));
  };

  // Initial data load
  useEffect(() => runApiRequest('http://127.0.0.1:5000/api/devices'), []);
  
  // Auto-resize map when expanded or collapsed
  useEffect(() => { if (networkRef.current) setTimeout(() => { networkRef.current.redraw(); networkRef.current.fit(); }, 300); }, [expanded]);

  // Render interactive topology map when devices change
  useEffect(() => {
    if (!devices.length || !mapRef.current) return;
    import('vis-network/standalone').then(({ Network, DataSet }) => {
      const router = devices.find(d => d.ip.endsWith('.1')) || devices[0];
      const others = devices.filter(d => d.ip !== router.ip);
      const getStyle = (d, isR) => {
        if (isR) return { shape: 'diamond', color: { background: DARK_PURPLE, border: ACC }, size: 45, fontColor: ACC };
        if (d.is_top_talker) return { shape: 'star', color: { background: '#7f1d1d', border: '#ef4444' }, size: 40, fontColor: '#ef4444' };
        if (d.vendor === "Apple") return { shape: 'box', color: { background: dark ? '#262626' : '#e5e5e5', border: '#a3a3a3' }, size: 30, fontColor: dark ? '#e5e7eb' : '#333' };
        return { shape: 'ellipse', color: { background: '#f3eeff', border: PURPLE }, size: 30, fontColor: DARK_PURPLE };
      };
      const nodes = new DataSet([
        { id: 1, label: `ROUTER\n${router.ip}`, title: `MAC: ${router.mac}`, ...getStyle(router, true), font: { color: getStyle(router, true).fontColor, size: 12 } },
        ...others.map((d, i) => ({
          id: i + 2, label: d.is_top_talker ? `TOP TALKER\n${d.ip}` : `${d.hostname || 'DEVICE'}\n${d.ip}`, 
          title: `Vendor: ${d.vendor}\nLatency: ${d.latency}\nPorts: ${d.open_ports?.join(', ') || 'None'}`, ...getStyle(d, false), font: { color: getStyle(d, false).fontColor, size: 11 }
        }))
      ]);
      const edges = new DataSet(others.map((_, i) => ({ from: 1, to: i + 2, color: { color: ACC }, width: 1.5 })));
      networkRef.current = new Network(mapRef.current, { nodes, edges }, { physics: { enabled: true } });
    });
  }, [devices, dark]);

  const securityData = getSecurityScore();
  const router = devices.find(d => d.ip.endsWith('.1')) || devices[0];
  const filteredDevices = devices.filter(d => !searchQuery || ['ip', 'hostname', 'mac', 'vendor', 'status'].some(key => d[key]?.toLowerCase().includes(searchQuery.toLowerCase())));

  // UI Component generators
  const btn = (label, onClick, style = {}) => <button onClick={onClick} style={{ border: 'none', borderRadius: '6px', padding: '8px 14px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold', ...style }}>{label}</button>;
  const card = (label, value, green = false) => (
    <div style={{ background: C.card, borderRadius: '8px', padding: '16px', border: `1px solid ${C.border}` }}>
      <div style={{ fontSize: '12px', color: C.subtext, marginBottom: '6px' }}>{label}</div>
      <div style={{ fontSize: '24px', fontWeight: 'bold', color: green ? '#16a34a' : C.text }}>{value}</div>
    </div>
  );
  const tdStyle = { padding: '10px', color: C.text, whiteSpace: 'nowrap' }; 

  return (
    <div style={{ fontFamily: 'Arial', background: C.bg, minHeight: '100vh', transition: 'background 0.3s' }}>
      <div style={{ background: PURPLE, padding: '14px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: '#fff', fontSize: '18px', fontWeight: 'bold' }}>Network Device Discovery Tool</span>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          {btn('Report UI Bug', () => setShowFeedback(true), { background: '#f59e0b', color: '#fff', marginRight: '20px' })}
          {lastScan && <span style={{ color: '#e0c8ff', fontSize: '11px' }}>Last scan: {lastScan}</span>}
          <input type="text" placeholder="e.g. 192.168.1.0/24 or 'simulate'" value={scanRange} onChange={e => setScanRange(e.target.value)} style={{ padding: '8px', borderRadius: '6px', border: 'none', outline: 'none' }} />
          {btn(loading ? 'Scanning...' : 'Scan Now', () => runApiRequest(`http://127.0.0.1:5000/api/scan${scanRange ? `?range=${encodeURIComponent(scanRange)}` : ''}`, true), { background: DARK_PURPLE, color: '#fff', border: '2px solid #fff' })}
          {btn(dark ? '☀ Light' : '☾ Dark', () => setDark(!dark), { background: dark ? '#fff' : '#1a1a2e', color: dark ? '#1a1a2e' : '#fff' })}
          {btn('Clear', () => { setDevices([]); setLastScan(null); }, { background: '#dc2626', color: '#fff' })}
        </div>
      </div>

      <div style={{ padding: '20px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '12px', marginBottom: '20px' }}>
          <div style={{ background: C.card, borderRadius: '8px', padding: '16px', border: `1px solid ${C.border}`, borderBottom: `4px solid ${securityData.color}` }}>
            <div style={{ fontSize: '12px', color: C.subtext, marginBottom: '6px' }}>Executive Security Score</div>
            <div><span style={{ fontSize: '28px', fontWeight: 'bold', color: securityData.color }}>{securityData.score}/100</span> <span style={{ fontSize: '14px', fontWeight: 'bold', color: securityData.color }}>Grade {securityData.grade}</span></div>
          </div>
          {card('Devices Found', devices.length)}
          {card('Current Network', router ? router.ip.split('.').slice(0, 3).join('.') + '.0/24' : '')}
          {card('Status', loading ? 'Auditing...' : 'Online', true)}
        </div>

        <div style={{ background: C.card, borderRadius: '8px', padding: '16px', border: `1px solid ${C.border}`, marginBottom: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <span style={{ fontSize: '13px', color: C.subtext }}>Smart Network Topology map</span>
            {btn(expanded ? 'Collapse' : 'Expand', () => setExpanded(!expanded), { background: PURPLE, color: '#fff' })}
          </div>
          <div ref={mapRef} style={{ height: expanded ? '520px' : '260px', background: C.mapBg, borderRadius: '6px', transition: 'height 0.3s' }} />
        </div>

        <div style={{ background: C.card, borderRadius: '8px', padding: '16px', border: `1px solid ${C.border}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <span style={{ fontSize: '14px', fontWeight: 'bold', color: C.text }}>Discovered Devices</span>
              <input type="text" placeholder="Search IP, MAC, Vendor..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} style={{ padding: '8px', borderRadius: '6px', border: `1px solid ${C.border}`, background: C.bg, color: C.text, outline: 'none', width: '250px' }} />
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              {btn('Export CSV', () => window.open('http://127.0.0.1:5000/api/export?format=csv'), { background: '#1a1a2e', color: '#fff' })}
              {btn('Export JSON', () => window.open('http://127.0.0.1:5000/api/export?format=json'), { background: '#1a1a2e', color: '#fff' })}
              {btn('Export PDF', () => window.open('http://127.0.0.1:5000/api/export?format=pdf'), { background: PURPLE, color: '#fff' })}
            </div>
          </div>

          {loading ? <p style={{ color: C.subtext }}>Auditing network and analyzing packets...</p> : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ background: '#1a1a2e' }}>
                    {['IP Address', 'Hostname', 'MAC Address', 'Vendor', 'Latency', 'Open Ports', 'Status', 'Action'].map(h => <th key={h} style={{ padding: '10px', textAlign: 'left', color: '#fff' }}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {filteredDevices.length > 0 ? filteredDevices.map((d, i) => (
                    <tr key={i} style={{ borderBottom: `0.5px solid ${C.border}`, background: d.is_top_talker ? (dark ? '#450a0a' : '#fee2e2') : (i % 2 === 0 ? C.tableBg1 : C.tableBg2) }}>
                      <td style={{ ...tdStyle, color: d.is_top_talker ? '#ef4444' : C.text, fontWeight: d.is_top_talker ? 'bold' : 'normal' }}>{d.ip} {d.is_top_talker && '⭐ (Top)'}</td>
                      <td style={tdStyle}>{d.hostname || 'Unknown'}</td>
                      <td style={{ ...tdStyle, fontFamily: 'monospace' }}>{d.mac}</td>
                      <td style={tdStyle}>{d.vendor || 'Unknown'}</td>
                      <td style={{ ...tdStyle, color: d.latency === 'Timeout' ? '#ef4444' : '#10b981', fontWeight: 'bold' }}>{d.latency || 'N/A'}</td>
                      <td style={tdStyle}>
                        {d.open_ports?.length ? <div style={{ display: 'flex', gap: '4px' }}>
                          {d.open_ports.map(p => {
                            const isRisk = [22, 23, 3389].includes(p);
                            return <span key={p} style={{ background: isRisk ? (dark ? '#450a0a' : '#fee2e2') : (dark ? '#1e1b4b' : '#e0e7ff'), color: isRisk ? '#ef4444' : '#6366f1', border: `1px solid ${isRisk ? '#f87171' : '#818cf8'}`, padding: '2px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: 'bold' }}>{p}</span>;
                          })}
                        </div> : <span style={{ color: C.subtext, fontSize: '11px' }}>None</span>}
                      </td>
                      <td style={tdStyle}><span style={{ background: '#dcfce7', color: '#16a34a', padding: '2px 10px', borderRadius: '99px', fontSize: '11px', fontWeight: 'bold' }}>{d.status || 'online'}</span></td>
                      <td style={tdStyle}>{btn('Report', () => setReportingDevice(d), { background: '#ef4444', color: '#fff', padding: '4px 8px' })}</td>
                    </tr>
                  )) : <tr><td colSpan="8" style={{ padding: '20px', textAlign: 'center', color: C.subtext }}>No devices match your search.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {reportingDevice && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
            <div style={{ background: C.card, padding: '24px', borderRadius: '8px', width: '400px', border: `1px solid ${C.border}` }}>
              <h3 style={{ color: C.text, marginTop: 0 }}>Log Issue for {reportingDevice.ip}</h3>
              <p style={{ fontSize: '12px', color: C.subtext }}>This will be saved to the local network complaints file.</p>
              <input type="text" placeholder="Your Name..." value={techName} onChange={e => setTechName(e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: '4px', background: C.bg, color: C.text, border: `1px solid ${C.border}`, marginBottom: '12px', boxSizing: 'border-box' }} />
              <textarea rows="4" placeholder="Describe the network issue here..." value={complaintText} onChange={e => setComplaintText(e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: '4px', background: C.bg, color: C.text, border: `1px solid ${C.border}`, marginBottom: '16px', boxSizing: 'border-box' }} />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                {btn('Cancel', () => { setReportingDevice(null); setComplaintText(''); }, { background: 'transparent', color: C.subtext, border: `1px solid ${C.border}` })}
                {btn('Save Local Ticket', submitDeviceTicket, { background: PURPLE, color: '#fff' })}
              </div>
            </div>
          </div>
        )}

        {showFeedback && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
            <div style={{ background: C.card, padding: '24px', borderRadius: '8px', width: '400px', border: `1px solid ${C.border}`, borderTop: '4px solid #f59e0b' }}>
              <h3 style={{ color: C.text, marginTop: 0 }}>Report Dashboard Bug</h3>
              <p style={{ fontSize: '12px', color: C.subtext }}>Is the interface broken? Submit a bug report directly to the developer.</p>
              <input type="text" placeholder="Your Name..." value={techName} onChange={e => setTechName(e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: '4px', background: C.bg, color: C.text, border: `1px solid ${C.border}`, marginBottom: '12px', boxSizing: 'border-box' }} />
              <textarea rows="4" placeholder="Describe the UI bug or feature request..." value={feedbackText} onChange={e => setFeedbackText(e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: '4px', background: C.bg, color: C.text, border: `1px solid ${C.border}`, marginBottom: '16px', boxSizing: 'border-box' }} />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                {btn('Cancel', () => { setShowFeedback(false); setFeedbackText(''); }, { background: 'transparent', color: C.subtext, border: `1px solid ${C.border}` })}
                {btn('Email Developer', submitSystemFeedback, { background: '#f59e0b', color: '#fff' })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}