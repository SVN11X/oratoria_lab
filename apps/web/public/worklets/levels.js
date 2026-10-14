class LevelsProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frames = 0;
    this.energy = 0;
    this.samples = 0;
  }
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (channel) {
      for (const value of channel) this.energy += value * value;
      this.samples += channel.length;
    }
    if (++this.frames >= 24) {
      this.port.postMessage(this.samples ? Math.sqrt(this.energy / this.samples) : 0);
      this.frames = 0;
      this.energy = 0;
      this.samples = 0;
    }
    return true;
  }
}
registerProcessor('oratoria-levels', LevelsProcessor);
