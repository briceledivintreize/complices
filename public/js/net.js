// Connexion temps réel : reconnexion automatique et horloge synchronisée avec le serveur
// (pour que les deux ardoises se lèvent au même instant).

export class Net {
  constructor({ roomId, playerId, secret, onState, onEvent, onStatus }) {
    Object.assign(this, { roomId, playerId, secret, onState, onEvent, onStatus });
    this.offset = 0;          // heure serveur ≈ Date.now() + offset
    this.bestRtt = Infinity;
    this.retry = 0;
    this.closed = false;
    this.connect();
    this.onVisible = () => {
      if (document.visibilityState === 'visible' && (!this.ws || this.ws.readyState > 1)) this.connect();
    };
    document.addEventListener('visibilitychange', this.onVisible);
    window.addEventListener('online', this.onVisible);
  }

  connect() {
    if (this.closed) return;
    clearTimeout(this.retryTimer);
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      ws.send(JSON.stringify({ t: 'hello', roomId: this.roomId, playerId: this.playerId, secret: this.secret }));
      this.ping(); setTimeout(() => this.ping(), 400); setTimeout(() => this.ping(), 1200);
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => this.ping(), 8000);
      this.onStatus('online');
    };
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'pong') {
        const now = Date.now();
        const rtt = now - m.clientT;
        if (rtt <= this.bestRtt * 1.5 || this.bestRtt === Infinity) {
          this.bestRtt = Math.min(this.bestRtt, rtt);
          this.offset = m.serverT + rtt / 2 - now;
        }
        return;
      }
      if (m.t === 'state') {
        if (this.bestRtt === Infinity) this.offset = m.view.serverNow - Date.now();
        this.onState(m);
        return;
      }
      this.onEvent(m);
    };
    ws.onclose = (e) => {
      clearInterval(this.pingTimer);
      if (this.ws !== ws) return;
      if (e.code === 4004) { this.onStatus('gone'); return; }
      if (e.code === 4000) { this.onStatus('replaced'); return; }
      if (this.closed) return;
      this.onStatus('offline');
      const wait = Math.min(8000, 400 * 2 ** this.retry++);
      this.retryTimer = setTimeout(() => this.connect(), wait);
    };
  }

  ping() { this.send({ t: 'ping', clientT: Date.now() }); }

  send(m) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }

  act(a, extra = {}) { this.send({ t: 'action', a, ...extra }); }

  /** Convertit une heure serveur en heure locale. */
  toLocal(serverTime) { return serverTime - this.offset; }

  close() {
    this.closed = true;
    clearInterval(this.pingTimer);
    clearTimeout(this.retryTimer);
    document.removeEventListener('visibilitychange', this.onVisible);
    window.removeEventListener('online', this.onVisible);
    if (this.ws) this.ws.close();
  }
}
