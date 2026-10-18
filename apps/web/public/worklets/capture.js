// Captura PCM del micrófono por bloques de unas 4096 muestras para transcribir en el equipo.
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.active = false;
    this.buffer = new Float32Array(4096);
    this.length = 0;
    this.port.onmessage = (e) => {
      this.active = !!e.data?.active;
      if (!this.active && this.length) {
        this.port.postMessage(this.buffer.slice(0, this.length));
        this.length = 0;
      }
    };
  }
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (this.active && channel) {
      for (let i = 0; i < channel.length; i++) {
        this.buffer[this.length++] = channel[i];
        if (this.length === this.buffer.length) {
          this.port.postMessage(this.buffer.slice(0));
          this.length = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('oratoria-capture', CaptureProcessor);
