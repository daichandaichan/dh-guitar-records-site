/* Hot Club Generator — 再生・書き出し・描画（依存なし）
   音は Karplus-Strong（撥弦の物理モデル）で作った波形を鳴らし、
   パン・残響・コンプで軽くミックスする。 */
(function (root) {
"use strict";
var H = root.HCG;

/* ---------- 波形をつくる ---------- */
function ksBuffer(ctx, freq, dur, damp, tone, pickPos, noiseLp) {
  var sr = ctx.sampleRate;
  var N = Math.max(4, Math.round(sr / freq));
  var line = new Float32Array(N), i;
  /* 撥弦の初期波形：やや鈍らせた雑音（ピックの当たり方） */
  var prev = 0;
  for (i = 0; i < N; i++) {
    var r = Math.random() * 2 - 1;
    prev = prev + (r - prev) * noiseLp;
    line[i] = prev;
  }
  /* 弾く位置＝その点に節を作る（倍音の出方が変わる） */
  var pp = Math.floor(N * pickPos);
  for (i = 0; i < pp; i++) line[i] *= i / pp;
  var len = Math.round(sr * dur), out = new Float32Array(len);
  var idx = 0, last = 0, dc = 0;
  for (i = 0; i < len; i++) {
    var cur = line[idx];
    out[i] = cur;
    var v = (cur * tone + last * (1 - tone)) * damp;
    last = cur;
    line[idx] = v;
    idx = (idx + 1) % N;
  }
  /* 直流除去と終わりのフェード */
  for (i = 0; i < len; i++) { dc = dc * 0.9995 + out[i] * 0.0005; out[i] -= dc; }
  var f = Math.min(len, Math.round(sr * 0.03));
  for (i = 0; i < f; i++) out[len - 1 - i] *= i / f;
  var buf = ctx.createBuffer(1, len, sr);
  buf.getChannelData(0).set(out);
  return buf;
}

/* 胴を張った打楽器（コンガ・ボンゴ・ティンバレス）の波形を一度だけ作る */
function tonalHit(ctx, f0, f1, dur, noise, decay) {
  var n = Math.max(1, Math.floor(ctx.sampleRate * dur)), b = ctx.createBuffer(1, n, ctx.sampleRate);
  var d = b.getChannelData(0), ph = 0, i, sr = ctx.sampleRate;
  for (i = 0; i < n; i++) {
    var t = i / sr, e = Math.exp(-t * decay);
    var f = f1 + (f0 - f1) * Math.exp(-t * 34);
    ph += 2 * Math.PI * f / sr;
    var sig = Math.sin(ph) * e;
    if (noise > 0 && t < 0.012) sig += (Math.random() * 2 - 1) * noise * (1 - t / 0.012);
    d[i] = sig;
  }
  return b;
}
/* 木・金属の打楽器（クラーベ・カウベル・アゴゴ）の波形 */
/* トーンホイールの定常波形を一度だけ作る（基音の整数周期＝継ぎ目なく繰り返せる） */
function wheelBuf(ctx, f, ratio, draw) {
  var sr = ctx.sampleRate;
  var cycles = Math.max(8, Math.round(f / 10));           /* だいたい0.1秒ぶん */
  var n = Math.max(64, Math.round(sr * cycles / f));
  var b = ctx.createBuffer(1, n, sr), d = b.getChannelData(0), i, k, mx = 0;
  for (i = 0; i < n; i++) {
    var t = i / sr, v = 0;
    for (k = 0; k < ratio.length; k++) v += Math.sin(2 * Math.PI * f * ratio[k] * t) * draw[k];
    d[i] = v;
    if (Math.abs(v) > mx) mx = Math.abs(v);
  }
  if (mx > 0) for (i = 0; i < n; i++) d[i] /= mx;
  return b;
}
function clickBuf(ctx, f1, f2, dur, decay) {
  var n = Math.max(1, Math.floor(ctx.sampleRate * dur)), b = ctx.createBuffer(1, n, ctx.sampleRate);
  var d = b.getChannelData(0), i, sr = ctx.sampleRate;
  for (i = 0; i < n; i++) {
    var t = i / sr, e = Math.exp(-t * decay);
    d[i] = (Math.sin(2 * Math.PI * f1 * t) * 0.7 + Math.sin(2 * Math.PI * f2 * t) * 0.3) * e;
  }
  return b;
}
/* トーンホイールの波形を一度だけ作る（ドローバーとレスリーの揺れを焼き込む） */
/* ドローバーの組み合わせ（コーラスごとに切り替える）：0＝従来の温かい音、1＝中域が厚い、2＝高い倍音まで全開（盛り上がり） */
var ORGAN_SETS = [
  { ratio: [0.5, 1, 2, 3, 4], draw: [0.55, 1.0, 0.62, 0.26, 0.22] },
  { ratio: [0.5, 1, 2, 3, 4, 6], draw: [0.7, 1.0, 0.82, 0.5, 0.34, 0.18] },
  { ratio: [0.5, 1, 2, 3, 4, 5, 6, 8], draw: [0.7, 1.0, 0.92, 0.72, 0.6, 0.4, 0.34, 0.22] }
];
function organBuf(ctx, f, dur, setIx) {
  var n = Math.max(1, Math.floor(ctx.sampleRate * dur)), b = ctx.createBuffer(1, n, ctx.sampleRate);
  var d = b.getChannelData(0), sr = ctx.sampleRate, i, k;
  var SET = ORGAN_SETS[setIx || 0] || ORGAN_SETS[0], ratio = SET.ratio, draw = SET.draw;
  var ph = [], detB = [1.0008, 1, 0.9993, 1.0012, 0.9989], det = [];
  for (k = 0; k < ratio.length; k++) { ph.push(0); det.push(detB[k % detB.length]); }
  var peak = 0;
  for (i = 0; i < n; i++) {
    var t = i / sr;
    var les = 1 + 0.14 * Math.sin(2 * Math.PI * 5.4 * t);          /* 回転による音量の揺れ */
    var vib = 1 + 0.0016 * Math.sin(2 * Math.PI * 5.4 * t + 1.1);  /* わずかなピッチの揺れ */
    var sig = 0;
    for (k = 0; k < ratio.length; k++) {
      var fr = f * ratio[k] * det[k] * vib;
      if (fr > sr * 0.45) continue;
      ph[k] += 2 * Math.PI * fr / sr;
      sig += Math.sin(ph[k]) * draw[k];
    }
    d[i] = sig * les;
    if (Math.abs(d[i]) > peak) peak = Math.abs(d[i]);
  }
  if (peak > 0) for (i = 0; i < n; i++) d[i] /= peak;
  return b;
}
function noiseBuf(ctx, dur, shape) {
  var sr = ctx.sampleRate, len = Math.round(sr * dur), out = new Float32Array(len), i;
  for (i = 0; i < len; i++) {
    var t = i / len;
    out[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, shape);
  }
  var buf = ctx.createBuffer(1, len, sr);
  buf.getChannelData(0).set(out);
  return buf;
}
/* 金物：非整数倍音の束＋雑音 */
function metalBuf(ctx, dur, base, ratios, noiseMix, decay) {
  var sr = ctx.sampleRate, len = Math.round(sr * dur), out = new Float32Array(len), i, k;
  var ph = [], amp = [];
  for (k = 0; k < ratios.length; k++) { ph[k] = Math.random() * 6.283; amp[k] = 1 / (1 + k * 0.6); }
  var nz = 0;
  for (i = 0; i < len; i++) {
    var t = i / sr, env = Math.exp(-t * decay), v = 0;
    for (k = 0; k < ratios.length; k++) {
      v += Math.sin(ph[k] + 6.283185 * base * ratios[k] * t) * amp[k];
    }
    nz = nz * 0.6 + (Math.random() * 2 - 1) * 0.4;
    out[i] = (v / ratios.length * (1 - noiseMix) + nz * noiseMix) * env;
  }
  var f = Math.min(len, Math.round(sr * 0.02));
  for (i = 0; i < f; i++) out[len - 1 - i] *= i / f;
  var buf = ctx.createBuffer(1, len, sr);
  buf.getChannelData(0).set(out);
  return buf;
}
/* 残響のインパルス応答（初期反射＋減衰する雑音） */
function irBuffer(ctx, dur, decay) {
  var sr = ctx.sampleRate, len = Math.round(sr * dur), buf = ctx.createBuffer(2, len, sr), c, i;
  for (c = 0; c < 2; c++) {
    var d = buf.getChannelData(c);
    for (i = 0; i < len; i++) {
      var t = i / sr;
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay) * Math.exp(-t * 1.6);
    }
    var taps = [0.011, 0.019, 0.029, 0.041, 0.057];
    for (i = 0; i < taps.length; i++) {
      var pos = Math.round(sr * taps[i] * (1 + c * 0.07));
      if (pos < len) d[pos] += (i % 2 ? -1 : 1) * 0.35 / (1 + i);
    }
  }
  return buf;
}

/* ---------- Web Audio ---------- */
function driveCurve(ctx, amount) {
  var n = 1024, c = new Float32Array(n), i, k = amount;
  for (i = 0; i < n; i++) {
    var x = i * 2 / n - 1;
    c[i] = (1 + k) * x / (1 + k * Math.abs(x));
  }
  return c;
}
/* 鍵盤の音を作る：ギターの撥弦とは別の作り方にして、編成の違いを出す */
Engine.prototype.keyNote = function (p, when, dur, v, type, out) {
  var ctx = this.ctx, f = 440 * Math.pow(2, (p - 69) / 12), i;
  var len = Math.max(0.12, dur);
  if (type === "organ") {
    /* オルガン：作り置きの波形を繰り返す（発振器を毎回作らない＝速い曲でも軽い） */
    this.tonewheel(p, when, len, Math.round(v * 127), out, 1.15, false);
    return;
  }
  /* ピアノ／エレピ：倍音を少しずらして重ね、打鍵の音を足して、指数で減衰させる */
  var lvN = Math.max(this.busy || 0, this.loadLevel ? this.loadLevel(when, 4) : 0, 1);   /* 和音の伴奏は倍音2本で十分 */
  var ps = (lvN >= 1) ? [[1, 1, 0], [2, 0.42, 0.7]]
    : [[1, 1, 0], [2, 0.42, 0.7], [3, 0.2, 1.4], [4.02, 0.11, 2.2]];
  for (i = 0; i < ps.length; i++) {
    var o2 = ctx.createOscillator(); o2.type = i === 0 ? "triangle" : "sine";
    o2.frequency.value = f * ps[i][0] * (1 + ps[i][2] * 0.0004);
    var g2 = ctx.createGain();
    var amp = 0.22 * v * ps[i][1] * (type === "harpsi" ? 0.8 : 1);
    var dec = (type === "harpsi" ? 0.55 : 1.9) / (1 + i * 0.6) * (1 + 40 / Math.max(60, f));
    g2.gain.setValueAtTime(0.0001, when);
    g2.gain.exponentialRampToValueAtTime(amp + 0.0005, when + (type === "harpsi" ? 0.004 : 0.008));
    g2.gain.exponentialRampToValueAtTime(0.0006, when + Math.min(len + 0.35, dec));
    o2.connect(g2); g2.connect(out); o2.start(when); o2.stop(when + Math.min(len + 0.4, dec) + 0.05);
  }
  /* 打鍵（ハンマー）の音 */
  if (type !== "organ" && this.bank && this.bank.drum.ghost) {
    this.play1(this.bank.drum.ghost, when, type === "harpsi" ? 3.2 : 2.0, 0.05 * v, out,
      type === "harpsi" ? 9000 : 5200, 0.03, 1400);
  }
};
function Engine() {
  this.ctx = null; this.master = null; this.timer = null; this.raf = null;
  this.playing = false; this.evs = []; this.idx = 0; this.t0 = 0; this.startBeat = 0;
  this.gains = {}; this.mute = {}; this.onTick = null; this.thin = false; this.bank = null;
  this.real = true;     /* 内蔵音源をリアル寄りにする（ドラム・ベース・ピアノ・管の細部と、部屋鳴り） */
}
/* スタイルごとのギターの鳴り：弦の種類・明るさ・鼻にかかる帯域・ピック音・胴鳴り・厚み・伸び */
/* GMの音色番号から、どの合成方式で鳴らすかを決める */
function instrOf(prog) {
  if (prog === 4 || prog === 5) return "rhodes";        /* エレクトリック・ピアノ */
  if (prog >= 16 && prog <= 23) return "organ";
  if (prog >= 56 && prog <= 79) return "horn";
  if (prog >= 0 && prog <= 5) return "piano";
  return "pluck";
}
var TONE = {
  gypsy:    { bank: "steel",    lp: [1900, 6400], nasal: 1450, pick: 0.17, body: 0.09, det: 0,  rel: 0.95, lead: "pluck", comp: "pluck" },
  swing:    { bank: "steel",    lp: [1150, 3200], nasal: 0,    pick: 0.05, body: 0.20, det: 0,  rel: 1.15, lead: "pluck", comp: "pluck" , pad: 0.15 },
  bebop:    { bank: "steel",    lp: [1400, 4200], nasal: 0,    pick: 0.08, body: 0.15, det: 0,  rel: 1.0, lead: "blown", comp: "keys" , pad: 0.11 },
  soul:     { bank: "steel",    lp: [1100, 3200], nasal: 0,    pick: 0.04, body: 0.21, det: 0,  rel: 1.2, lead: "pluck", comp: "organ" , pad: 0.20 },
  ballad:   { bank: "steel",    lp: [1150, 3300], nasal: 0,    pick: 0.04, body: 0.19, det: 0,  rel: 1.25, lead: "pluck", comp: "keys" , pad: 0.26 },
  bossa:    { bank: "nylon",    lp: [1500, 4200], nasal: 0,    pick: 0.06, body: 0.14, det: 0,  rel: 1.0 },
  brazil:   { bank: "nylon",    lp: [1650, 4700], nasal: 0,    pick: 0.08, body: 0.13, det: 0,  rel: 0.95, lead: "pluck", comp: "pluck" },
  latin:    { bank: "nylon",    lp: [1600, 4400], nasal: 0,    pick: 0.07, body: 0.13, det: 0,  rel: 1.0, lead: "blown", comp: "keys" },
  flamenco: { bank: "nylon",    lp: [2300, 7600], nasal: 950,  pick: 0.26, body: 0.12, det: 0,  rel: 0.82, flam: 1 },
  modern:   { bank: "electric", lp: [1700, 5200], nasal: 0,    pick: 0.03, body: 0.05, det: 7,  rel: 1.6, lead: "pluck", comp: "keys" , pad: 0.13 },
  odd:      { bank: "electric", lp: [1700, 5000], nasal: 0,    pick: 0.04, body: 0.05, det: 7,  rel: 1.5, lead: "pluck", comp: "keys" },
  chip:     { bank: "nylon", lp: [2000, 6000], nasal: 0, pick: 0.02, body: 0.05, det: 3, rel: 1.6, lvl: 0.6, lead: "pluck", comp: "pluck", chip: 1 },
  game:     { bank: "nylon", lp: [2000, 6000], nasal: 0, pick: 0.02, body: 0.05, det: 3, rel: 1.6, lvl: 0.6, lead: "pluck", comp: "pluck", orch: 1 },
  epic:     { bank: "nylon", lp: [2000, 6000], nasal: 0, pick: 0.02, body: 0.05, det: 3, rel: 1.6, lvl: 0.6, lead: "pluck", comp: "pluck", orch: 1 },
  djent:    { bank: "electric", lp: [1500, 3800], nasal: 0, pick: 0.14, body: 0.03, det: 4, rel: 0.9, drive: 14, driveComp: 22, lvl: 0.55, lead: "pluck", comp: "pluck" },
  djentf:   { bank: "electric", lp: [1900, 5200], nasal: 0, pick: 0.10, body: 0.04, det: 5, rel: 1.0, drive: 0, driveComp: 16, lvl: 0.6, lead: "pluck", comp: "pluck" },
  mathrock: { bank: "electric", lp: [1600, 5400], nasal: 0, pick: 0.06, body: 0.06, det: 6, rel: 1.3, drive: 8, lvl: 0.6, lead: "pluck", comp: "pluck" },
  fusion:   { bank: "electric", lp: [1500, 4600], nasal: 0, pick: 0.03, body: 0.08, det: 4, rel: 1.4, lead: "keys", comp: "keys", pad: 0.10 },
  /* マクラフリン風：歪みのある、伸びるギター（フュージョン＝エレピ伴奏／オルガン・ジャズ＝オルガン伴奏） */
  /* 80年代の産業ロック：歪んだギター（歌う）とシンセ（リフ・パッド） */
  arena:    { bank: "electric", lp: [1700, 5600], nasal: 0, pick: 0.06, body: 0.05, det: 7, rel: 1.8, drive: 8, lvl: 0.78, lead: "pluck", comp: "synth", pad: 0 },
  /* マクラフリン風オルガン・トリオ：ベース奏者はいない＝オルガンの左手（足鍵盤）がベース */
  mcl_organtrio: { bank: "electric", lp: [1700, 6000], nasal: 0, pick: 0.07, body: 0.04, det: 8, rel: 1.9, drive: 9, lvl: 0.7, lead: "pluck", comp: "organ", bassOrgan: true },
  mclaughlin_f: { bank: "electric", lp: [1700, 6200], nasal: 0, pick: 0.07, body: 0.04, det: 8, rel: 1.9, drive: 9, lvl: 0.7, lead: "pluck", comp: "keys", pad: 0.08 },
  mclaughlin_o: { bank: "electric", lp: [1700, 6000], nasal: 0, pick: 0.07, body: 0.04, det: 8, rel: 1.9, drive: 9, lvl: 0.7, lead: "pluck", comp: "organ", bassOrgan: true },
  /* フュージョンの型：歪みのある、伸びるリード・ギター（ラテン・ロック型） */
  fu_lead: { bank: "electric", lp: [1600, 5200], nasal: 0, pick: 0.05, body: 0.05, det: 6, rel: 2.1, drive: 7, lvl: 0.75, lead: "pluck", comp: "keys", pad: 0.06 },
  /* スーパー・ギタートリオ：3本のギターそれぞれの音色（gt_mel＝ギター1、gt_solo＝ギター2、gt_gt3＝ギター3） */
  guitartrio: { bank: "steel", lp: [1700, 6000], nasal: 0, pick: 0.14, body: 0.08, det: 0, rel: 1.2, lead: "pluck", comp: "pluck" },
  gt_mel:   { bank: "steel", lp: [1500, 5600], nasal: 0, pick: 0.10, body: 0.09, det: 5, rel: 1.6, lvl: 0.9, lead: "pluck", comp: "pluck" },
  gt_solo:  { bank: "nylon", lp: [2300, 7600], nasal: 950, pick: 0.26, body: 0.12, det: 0, rel: 0.82, flam: 1 },
  gt_gt3:   { bank: "steel", lp: [1900, 6800], nasal: 0, pick: 0.20, body: 0.07, det: 2, rel: 0.9, lead: "pluck", comp: "pluck" },
  gt_gtrg:  { bank: "nylon", lp: [2300, 7600], nasal: 950, pick: 0.26, body: 0.12, det: 0, rel: 0.82, flam: 1 },
  wa:       { bank: "steel",    lp: [2600, 8200], nasal: 2100, pick: 0.22, body: 0.05, det: 0, rel: 0.78, lead: "pluck", comp: "pluck" },
  classical: { bank: "nylon",  lp: [1200, 5600], nasal: 0, pick: 0.09, body: 0.20, det: 0, rel: 1.6, lvl: 1.3, lead: "pluck", comp: "pluck" },
  classical: { bank: "nylon",  lp: [850, 6600], nasal: 0, pick: 0.10, body: 0.20, det: 0, rel: 1.35, lead: "pluck", comp: "pluck" },
  baroque:  { bank: "steel",    lp: [2400, 7600], nasal: 1900, pick: 0.10, body: 0.06, det: 0, rel: 0.7, vib: 0, lead: "pluck", comp: "keys", keysKind: "harpsi" },
  neo:      { bank: "electric", lp: [2200, 7000], nasal: 0, pick: 0.05, body: 0.03, det: 9, rel: 2.0, drive: 10, lvl: 0.5 },
  waltz:    { bank: "steel",    lp: [1500, 4300], nasal: 0,    pick: 0.08, body: 0.14, det: 0,  rel: 1.0 },
  /* インド古典：シタールの鋭い倍音と長い余韻（ヴァイオリン・バンスリは管弦の声を借りる） */
  indian:   { bank: "steel",    lp: [1800, 6200], nasal: 1500, pick: 0.14, body: 0.10, det: 0,  rel: 1.3, lead: "pluck", comp: "pluck", ind: 1 }
};
TONE.organjazz = Object.assign({}, TONE.swing, { bassOrgan: true });        /* オルガン・ジャズ：ベースはオルガンの左手（と足鍵盤） */
var BANKP = {
  steel:    { damp: [0.9955, 200000], tone: [0.58, 1400], pick: 0.16, nz: 0.55, dur: 1.0 },
  nylon:    { damp: [0.9948, 240000], tone: [0.46, 1900], pick: 0.26, nz: 0.28, dur: 0.85 },
  electric: { damp: [0.9972, 320000], tone: [0.70, 1200], pick: 0.11, nz: 0.72, dur: 1.35 }
};
var MIX = {
  mel:   { gain: 0.95, pan: 0.14, verb: 0.30 },
  gt3:   { gain: 0.95, pan: 0.5,  verb: 0.26 },
  gtrg:  { gain: 0.9,  pan: 0.0,  verb: 0.24 },
  solo:  { gain: 1.0,  pan: -0.10, verb: 0.30 },
  comp:  { gain: 1.0,  pan: -0.34, verb: 0.24 },
  pno:   { gain: 0.9,  pan: 0.30, verb: 0.26 },     /* ピアノの伴奏（追加）：ギターの伴奏と左右に分ける */     /* 測定（build #221）：伴奏がテーマより 12〜18dB 小さかった → 約 +4dB */
  bass:  { gain: 0.86, pan: 0.0,  verb: 0.05 },
  drums: { gain: 0.64, pan: 0.10, verb: 0.16 },
  perc:  { gain: 0.55, pan: -0.18, verb: 0.20 },
  perc2: { gain: 0.5,  pan: 0.24,  verb: 0.20 },
  perc3: { gain: 0.5,  pan: -0.06, verb: 0.22 },
  jaleo: { gain: 0.6,  pan: -0.10, verb: 0.34 },
  wfl:   { gain: 0.85, pan: 0.34,  verb: 0.32 },
  wsx:   { gain: 0.85, pan: 0.34,  verb: 0.28 },
  gtr2:  { gain: 0.8,  pan: -0.46, verb: 0.24 },
  cante: { gain: 0.7,  pan: 0.0,   verb: 0.34 },
  horn:  { gain: 0.8,  pan: -0.22, verb: 0.42 },
  harp:  { gain: 0.75, pan: 0.28, verb: 0.40 },
  timp:  { gain: 0.9,  pan: 0.05, verb: 0.35 },
  cello: { gain: 0.8,  pan: 0.18, verb: 0.38 },
  fl:    { gain: 0.62, pan: 0.28, verb: 0.42 },
  ob:    { gain: 0.6,  pan: 0.12, verb: 0.4 },
  cl:    { gain: 0.62, pan: -0.12, verb: 0.4 },
  bsn:   { gain: 0.66, pan: 0.18, verb: 0.38 },
  tpt:   { gain: 0.6,  pan: 0.32, verb: 0.42 },
  trb:   { gain: 0.6,  pan: -0.32, verb: 0.42 },
  tuba:  { gain: 0.72, pan: -0.18, verb: 0.38 }
};
Engine.prototype.ensure = function () {
  if (this.ctx && this.ctx.state !== "closed") {
    if (this.ctx.state === "suspended") { try { var rp = this.ctx.resume(); if (rp && rp.catch) rp.catch(function () {}); } catch (e0) {} }   /* 書き出し用の OfflineAudioContext では resume できない（無害） */
    return;
  }
  var AC = root.AudioContext || root.webkitAudioContext;
  this.ctx = new AC();
  var ctx = this.ctx;
  /* 出口：軽いコンプ→出力 */
  this.master = ctx.createGain(); this.master.gain.value = 0.92;
  var comp = ctx.createDynamicsCompressor();
  try {
    comp.threshold.value = -14; comp.knee.value = 22; comp.ratio.value = 3.2;
    comp.attack.value = 0.006; comp.release.value = 0.18;
  } catch (e) {}
  this.master.connect(comp); comp.connect(ctx.destination);
  /* 初期反射：小さな部屋の壁からの返り（11・17・29ms）。ごく小さく足して、音が空中に浮かないようにする */
  this.early = [];
  try {
    [[0.011, 0.045], [0.017, 0.035], [0.029, 0.028]].forEach(function (t) {
      var dl = ctx.createDelay(0.06), eg = ctx.createGain(), lpE = ctx.createBiquadFilter();
      dl.delayTime.value = t[0]; eg.gain.value = t[1]; lpE.type = "lowpass"; lpE.frequency.value = 5200;
      this.master.connect(dl); dl.connect(lpE); lpE.connect(eg); eg.connect(comp);
      this.early.push(eg);
    }, this);
  } catch (x) { this.early = []; }
  /* 残響 */
  try {
    this.verb = ctx.createConvolver();
    this.verb.buffer = irBuffer(ctx, this.thin ? 0.8 : 1.25, 2.2);
    this.verbIn = ctx.createGain(); this.verbIn.gain.value = 1;
    var hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 260;
    this.verbIn.connect(hp); hp.connect(this.verb); this.verb.connect(this.master);
  } catch (e) { this.verb = null; }
  this.gains = {};
  this.bank = null;
};
Engine.prototype.gtrBank = function (kind) {
  if (!this.banks) this.banks = {};
  if (this.banks[kind]) return this.banks[kind];
  var ctx = this.ctx, P = BANKP[kind] || BANKP.steel, i;
  var b = { buf: [], buf2: [], pitch: [] };
  for (i = 40; i <= 88; i += 4) {
    var f = 440 * Math.pow(2, (i - 69) / 12);
    var dur = (i < 56 ? 2.2 : (i < 72 ? 1.7 : 1.2)) * P.dur * (this.thin ? 0.6 : 1);
    var dmp = Math.min(0.9995, P.damp[0] + f / P.damp[1]);
    var tn = Math.min(0.95, P.tone[0] + f / P.tone[1]);
    b.buf.push(ksBuffer(ctx, f, dur, dmp, tn, P.pick, P.nz));
    /* もう1種類：弾く位置と当たり方を変えた同じ音（同じ音が続いても表情が変わる） */
    if (!this.thin) b.buf2.push(ksBuffer(ctx, f, dur, dmp, tn * 0.94, P.pick * 1.45, P.nz * 0.8));
    b.pitch.push(i);
  }
  this.banks[kind] = b;
  return b;
};
Engine.prototype.buildBank = function () {
  if (this.bank) return;
  var ctx = this.ctx, i;
  var b = { bass: [], bassPitch: [], drum: {} };
  for (i = 28; i <= 56; i += 5) {
    var f2 = 440 * Math.pow(2, (i - 69) / 12);
    b.bass.push(ksBuffer(ctx, f2, this.thin ? 1.7 : 2.6, Math.min(0.999, 0.997 + f2 / 300000),
      Math.min(0.62, 0.3 + f2 / 900), 0.1, 0.28));
    b.bassPitch.push(i);
  }
  var R = [1, 1.42, 1.81, 2.36, 2.93, 3.61, 4.27, 5.08];
  b.drum.ride = metalBuf(ctx, 1.5, 520, R, 0.42, 3.4);
  b.drum.ride2 = metalBuf(ctx, 1.2, 640, R, 0.5, 4.6);
  b.drum.bell = metalBuf(ctx, 0.9, 860, [1, 1.5, 2.1, 3.2], 0.15, 5.5);
  b.drum.crash = metalBuf(ctx, 2.2, 380, R.concat([6.3, 7.9]), 0.62, 1.5);
  b.drum.crash2 = metalBuf(ctx, 1.6, 470, R.concat([6.9]), 0.66, 2.2);
  b.drum.hh = noiseBuf(ctx, 0.09, 3.2);
  b.drum.hhM = metalBuf(ctx, 0.14, 3300, [1, 1.34, 1.79, 2.2, 3.31, 4.07], 0.45, 26);
  b.drum.hhOM = metalBuf(ctx, 0.55, 3100, [1, 1.34, 1.79, 2.2, 3.31, 4.07], 0.42, 7);
  b.drum.ping = clickBuf(ctx, 4200, 3000, 0.03, 90);
  b.drum.hhO = noiseBuf(ctx, 0.45, 1.4);
  b.drum.brush = noiseBuf(ctx, 0.14, 2.0);
  b.drum.clap = noiseBuf(ctx, 0.13, 2.6);
  b.drum.snare = noiseBuf(ctx, 0.22, 2.4);
  b.drum.ghost = noiseBuf(ctx, 0.09, 3.0);
  /* 胴もの・木もの・金属ものは波形を作り置きする（発振器を毎回作らない） */
  b.drum.congaH = tonalHit(ctx, 440, 300, 0.36, 0.30, 12);
  b.drum.congaM = tonalHit(ctx, 300, 205, 0.42, 0.26, 10);
  b.drum.congaL = tonalHit(ctx, 210, 148, 0.55, 0.22, 8);
  b.drum.bongoH = tonalHit(ctx, 900, 620, 0.22, 0.34, 20);
  b.drum.bongoL = tonalHit(ctx, 640, 440, 0.26, 0.30, 17);
  b.drum.timbH = tonalHit(ctx, 700, 520, 0.28, 0.40, 16);
  b.drum.timbL = tonalHit(ctx, 520, 380, 0.34, 0.36, 13);
  b.drum.surdo = tonalHit(ctx, 130, 88, 0.6, 0.18, 7);
  b.drum.tomL = tonalHit(ctx, 220, 150, 0.5, 0.25, 9);
  b.drum.tomM = tonalHit(ctx, 300, 205, 0.44, 0.25, 10);
  b.drum.tomH = tonalHit(ctx, 400, 270, 0.38, 0.25, 11);
  b.drum.clave = clickBuf(ctx, 2500, 1250, 0.09, 42);
  b.drum.wood = clickBuf(ctx, 1600, 800, 0.10, 38);
  b.drum.cowbell = clickBuf(ctx, 835, 1235, 0.30, 14);
  b.drum.agogoH = clickBuf(ctx, 1200, 1800, 0.26, 15);
  b.drum.agogoL = clickBuf(ctx, 900, 1350, 0.30, 13);
  this.bank = b;
  this.gtrBank((this.tone || TONE.swing).bank);
};
/* ピアノ：打弦の立ち上がりと、倍音ごとに違う減衰 */
Engine.prototype.synthRhodes = function (p, when, dur, v, out) {
  var ctx = this.ctx, f = hz(p), len = Math.max(0.35, Math.min(dur + 0.7, 3.4)), i;
  var lvR = Math.max(this.busy || 0, this.loadLevel ? this.loadLevel(when, 5) : 0);
  var parts = (lvR >= 1 || this.curKind === "comp") ? [1, 2, 4] : [1, 2, 4, 7.2], gains = [1, 0.3, 0.16, 0.05];   /* 4倍・7.2倍で鐘の色 */
  for (i = 0; i < parts.length; i++) {
    var o = ctx.createOscillator(); o.type = "sine";
    o.frequency.value = f * parts[i] * (1 + (Math.random() - 0.5) * 0.0012);
    var g = ctx.createGain();
    var pk = (0.26 * v) * gains[i];
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(pk, when + (i === 0 ? 0.012 : 0.005));
    g.gain.exponentialRampToValueAtTime(0.0002, when + len * (i === 0 ? 1 : 0.35));
    o.connect(g); g.connect(out); o.start(when); o.stop(when + len + 0.1);
  }
  /* トーンバーに当たる音 */
  if (this.bank && this.bank.drum && lvR < 1) {
    this.play1(this.bank.drum.ghost, when, 2.6, 0.05 * v, out, 7000, 0.03, 2200);
  }
};
Engine.prototype.synthPiano = function (p, when, dur, v, out) {
  var ctx = this.ctx, f = 440 * Math.pow(2, (p - 69) / 12), i;
  var lvP = Math.max(this.busy || 0, this.loadLevel ? this.loadLevel(when, 6) : 0);
  /* 倍音の本数は負荷で変える（和音は何音も重なるので、少なくても十分に鳴る） */
  /* 和音の伴奏は何音も重なるので倍音は2本で十分（軽くする） */
  var parts = (lvP >= 2 || this.curKind === "comp") ? [[1, 1], [2, 0.42]]
    : (lvP >= 1 ? [[1, 1], [2, 0.42], [3, 0.19]]
      : [[1, 1], [2, 0.42], [3, 0.19], [5.02, 0.08]]);
  var len = Math.max(0.3, Math.min(dur + 0.6, 3.2));
  for (i = 0; i < parts.length; i++) {
    var o = ctx.createOscillator(); o.type = "sine";
    o.frequency.value = f * parts[i][0] * (1 + i * 0.0006);      /* 弦の非調和 */
    var g = ctx.createGain();
    var a = 0.45 * v * parts[i][1] * ((this.real !== false && i > 0) ? (0.55 + 0.9 * v) : 1) * (this.real !== false ? 0.68 : 1);   /* 強く弾くほど倍音が増える（全体の音量は旧音源に合わせる） */
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, a), when + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, when + len * (1 - i * 0.13));
    o.connect(g); g.connect(out); o.start(when); o.stop(when + len + 0.05);
    /* 同じ鍵を弾く複数の弦はわずかにずれる（うなり）。低い2本の倍音だけ */
    if (this.real !== false && i < 2 && lvP < 1 && !this.thin && this.curKind !== "comp") {
      var o3 = ctx.createOscillator(); o3.type = "sine"; o3.frequency.value = f * parts[i][0] * (1 + i * 0.0006) * 1.0011;
      var g3 = ctx.createGain(); g3.gain.setValueAtTime(0.0001, when);
      g3.gain.exponentialRampToValueAtTime(Math.max(0.0002, a * 0.45), when + 0.008);
      g3.gain.exponentialRampToValueAtTime(0.0001, when + len * (1.12 - i * 0.1));
      o3.connect(g3); g3.connect(out); o3.start(when); o3.stop(when + len * 1.15 + 0.05);
    }
  }
  /* 打鍵の音（混んでいるときは省く） */
  if (lvP < 1) this.play1(this.bank.drum.ghost, when, 2.6, 0.05 * v, out, 5200, 0.03, 900);
  if (this.real !== false && lvP < 1 && !this.thin && v > 0.45) this.play1(this.bank.drum.ghost, when, 0.55, 0.05 * v, out, 520, 0.05);   /* ハンマーと鍵盤の低い音 */
};
/* 管：息の立ち上がりとビブラート */
Engine.prototype.synthHorn = function (p, when, dur, v, out) {
  var ctx = this.ctx, f = 440 * Math.pow(2, (p - 69) / 12);
  var len = Math.max(0.16, dur);
  var o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.setValueAtTime(f * 0.995, when);
  o.frequency.exponentialRampToValueAtTime(f, when + 0.05);
  var lp = ctx.createBiquadFilter(); lp.type = "lowpass";
  lp.frequency.setValueAtTime(600 + 2600 * v, when);
  lp.frequency.exponentialRampToValueAtTime(700 + 1500 * v, when + len);
  lp.Q.value = 1.2;
  var fm = ctx.createBiquadFilter(); fm.type = "peaking";   /* 管らしい鳴り */
  fm.frequency.value = 900 + 300 * v; fm.Q.value = 1.6; fm.gain.value = 6;
  var g = ctx.createGain(), pkH = 0.22 * v + 0.015;
  g.gain.setValueAtTime(0.0001, when);
  g.gain.linearRampToValueAtTime(pkH, when + 0.05);
  g.gain.linearRampToValueAtTime(pkH * 0.9, when + Math.max(0.1, len));
  g.gain.linearRampToValueAtTime(0.0001, when + Math.max(0.1, len) + 0.09);
  o.connect(lp); lp.connect(fm); fm.connect(g); g.connect(out);
  o.start(when); o.stop(when + len + 0.12);
  if (len > 0.35) {                       /* ビブラート */
    try {
      var lfo = ctx.createOscillator(), lg = ctx.createGain();
      lfo.frequency.value = 5.3 + Math.random() * 0.8; lg.gain.value = f * 0.006;
      lfo.connect(lg); lg.connect(o.frequency); lfo.start(when + 0.18); lfo.stop(when + len + 0.1);
    } catch (e) {}
  }
  this.play1(this.bank.drum.ghost, when, 3.2, 0.03 * v, out, 7000, 0.04, 2500);  /* 息 */
};
/* シンセ（のこぎり波2本＋フィルター）：短い音はリフ・スタブ、長い音（1.2秒〜）はゆっくり立ち上がるパッド */
Engine.prototype.synthSaw = function (p, when, dur, v, out) {
  var ctx = this.ctx, pad = dur > 1.2, f = 440 * Math.pow(2, (p - 69) / 12);
  if (this.loadLevel && this.loadLevel(when, 2) >= 2 && v < 0.5) return;
  var g = ctx.createGain(), lp = ctx.createBiquadFilter();
  lp.type = "lowpass"; lp.Q.value = pad ? 0.8 : 3.0;
  var peak = Math.min(1, v) * (pad ? 0.10 : 0.16), a = pad ? 0.16 : 0.006, rel = pad ? 0.5 : 0.10, end = when + Math.max(0.08, dur);
  g.gain.setValueAtTime(0.0001, when); g.gain.linearRampToValueAtTime(peak, when + a);
  g.gain.setValueAtTime(peak * (pad ? 1 : 0.85), Math.max(when + a, end - rel)); g.gain.exponentialRampToValueAtTime(0.0005, end + rel);
  var top = pad ? 1500 + 1800 * v : 900 + 4200 * v;
  lp.frequency.setValueAtTime(top, when); lp.frequency.exponentialRampToValueAtTime(Math.max(500, top * (pad ? 0.7 : 0.36)), when + (pad ? 1.2 : 0.22));
  var det = [-7, 7], k;
  for (k = 0; k < 2; k++) {
    var o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.setValueAtTime(f, when); o.detune.value = det[k];
    o.connect(lp); o.start(when); o.stop(end + rel + 0.05);
  }
  lp.connect(g); g.connect(out);
};
/* オルガン：足し算の音（ドローバー） */
Engine.prototype.synthOrgan = function (p, when, dur, v, out) {
  this.tonewheel(p, when, dur, Math.round(v * 127), out, 1, true);
};

Engine.prototype.chain = function (k) {
  var ctx = this.ctx, m = MIX[k] || MIX.mel;
  var g = ctx.createGain(); g.gain.value = this.mute[k] ? 0 : m.gain * ((this.volMul && this.volMul[k]) || 1);
  var node = g;
  if (k === "mel" || k === "solo" || k === "comp") {
    /* 胴の共鳴（低域の膨らみ）と、指が当たる帯域の持ち上げ */
    try {
      var bo = ctx.createBiquadFilter(); bo.type = "peaking";
      bo.frequency.value = (k === "comp") ? 118 : 104; bo.Q.value = 1.1; bo.gain.value = 4.5;
      var pr = ctx.createBiquadFilter(); pr.type = "peaking";
      pr.frequency.value = 2400; pr.Q.value = 0.8; pr.gain.value = 2.5;
      node.connect(bo); bo.connect(pr); node = pr;
    } catch (e) {}
  }
  if (k === "bass" && this.real !== false) {
    /* ウッドベースの胴：低域と中低域の共鳴を持ち上げ、弦の高い倍音を抑える */
    try {
      var bb1 = ctx.createBiquadFilter(); bb1.type = "peaking"; bb1.frequency.value = 92; bb1.Q.value = 1.0; bb1.gain.value = 3.0;
      var bb2 = ctx.createBiquadFilter(); bb2.type = "peaking"; bb2.frequency.value = 230; bb2.Q.value = 1.2; bb2.gain.value = 2.5;
      var bb3 = ctx.createBiquadFilter(); bb3.type = "highshelf"; bb3.frequency.value = 2400; bb3.gain.value = -4;
      node.connect(bb1); bb1.connect(bb2); bb2.connect(bb3); node = bb3;
    } catch (x) {}
  }
  if (k === "horn" || k === "comp") {
    /* レスリー：遅れをゆらす（ドップラー）と、元の音との混ぜ。回転の速さは rotarySetup で曲に合わせる */
    try {
      var rin = node, rdel = ctx.createDelay(0.05), rwet = ctx.createGain(), rdry = ctx.createGain(), rsum = ctx.createGain();
      var rl = ctx.createOscillator(), ra = ctx.createGain();
      rdel.delayTime.value = 0.0035; rl.type = "sine"; rl.frequency.value = 0.9; ra.gain.value = 0.0013;
      rl.connect(ra); ra.connect(rdel.delayTime); rl.start();
      rwet.gain.value = 0; rdry.gain.value = 1;
      rin.connect(rdry); rin.connect(rdel); rdel.connect(rwet); rdry.connect(rsum); rwet.connect(rsum);
      node = rsum;
      (this._rot = this._rot || {})[k] = { lfo: rl, amp: ra, wet: rwet, dry: rdry };
    } catch (xr) {}
  }
  if (ctx.createStereoPanner) {
    var pan = ctx.createStereoPanner(); pan.pan.value = m.pan;
    (this._pans = this._pans || {})[k] = pan;
    g.connect(pan); node = pan;
  }
  node.connect(this.master);
  if (this.verb) {
    var send = ctx.createGain(); send.gain.value = m.verb;
    node.connect(send); send.connect(this.verbIn);
  }
  return g;
};
/* 定位：フラメンコは半円に並ぶ（パルメロが左右に開き、歌は中央、掛け声は遠く）。インドはタンプーラを後ろ（左）、タブラを右前 */
var PAN_FLAM = { mel: 0.16, solo: -0.18, comp: -0.30, bass: 0.0, drums: 0.20, perc: -0.42, perc2: 0.44, perc3: 0.10, jaleo: -0.30, cante: 0.0, wfl: 0.34, wsx: 0.34, gtr2: -0.5 };
var PAN_IND = { mel: 0.12, solo: -0.2, harp: -0.34, drums: 0.30, perc: -0.2, perc2: 0.2, bass: 0.0, comp: -0.12 };
var PAN_GT = { mel: -0.55, solo: 0.0, gtrg: 0.0, gt3: 0.55 };
Engine.prototype.applyPan = function () {
  var pans = this._pans, t = this.tone || {}, k;
  if (!pans) return;
  for (k in pans) {
    var v = (t.flam && PAN_FLAM[k] != null) ? PAN_FLAM[k] : ((t.ind && PAN_IND[k] != null) ? PAN_IND[k] : (MIX[k] ? MIX[k].pan : 0));
    if (this.song && this.song.guitarTrio && PAN_GT[k] != null) v = PAN_GT[k];                  /* ギタートリオ：左＝ギター1、中央＝ギター2、右＝ギター3 */
    try { pans[k].pan.value = v; } catch (x) {}
  }
};
Engine.prototype.reset = function () {
  try { if (this.ctx) this.ctx.close(); } catch (e) {}
  this.ctx = null; this.bank = null; this.gains = {}; this.ensure();
};
/* ---------- 音声ループ（ユーザーが読み込んだ WAV／MP3）を、曲と同じテンポで重ねて鳴らす ----------
   ループの長さ（bars 小節 × bpb 拍）が曲のテンポで ちょうど収まるように再生速度を合わせ、小節の頭から繰り返す。 */
Engine.prototype.setLoop = function (buf, o) {
  var self = this;
  if (this._loopMuted) { this._loopMuted.forEach(function (k) { self.setMute(k, false); }); this._loopMuted = null; }
  this.stopLoopSrcs();
  if (!buf) { this.loop = null; return; }
  o = o || {};
  this.loop = { buf: buf, bars: Math.max(1, o.bars || 4), bpb: Math.max(1, o.bpb || 4), start: o.start || 0, gain: o.gain == null ? 1 : o.gain, on: o.on !== false, replace: o.replace || [] };
  if (this.loop.on && this.loop.replace.length) {
    this._loopMuted = this.loop.replace.slice();
    this._loopMuted.forEach(function (k) { self.setMute(k, true); });
  }
  if (this.playing && this.loop.on && this.ctx && this.song) {                       /* 再生中の変更は、いまの小節から入れ直す */
    var cb = (this.ctx.currentTime - this.t0) / this.spb, lb = this.loop.bars * this.loop.bpb;
    this._lk = Math.max(0, Math.floor((cb - this.loop.start) / lb));
  }
};
Engine.prototype.stopLoopSrcs = function () {
  (this._ls || []).forEach(function (s) { try { s.stop(0); } catch (e) {} });
  this._ls = [];
};
Engine.prototype.pumpLoop = function (now, ahead) {
  var L = this.loop;
  if (!L || !L.on || !L.buf || !this.song || !this.ctx) return;
  var ctx = this.ctx, lb = L.bars * L.bpb, sec = lb * this.spb, rate = L.buf.duration / sec;
  if (!this._lg || this._lgCtx !== ctx) { this._lg = ctx.createGain(); this._lg.connect(this.master); this._lgCtx = ctx; }
  this._lg.gain.value = 0.9 * L.gain;
  this._ls = this._ls || [];
  var guard = 0;
  while (guard++ < 8) {
    var tb = L.start + (this._lk || 0) * lb;
    if (tb >= this.song.totalBeats - 0.01) break;
    var ts = this.t0 + tb * this.spb;
    if (ts >= ahead) break;
    if (ts + sec > now + 0.03) {
      var src = ctx.createBufferSource();
      src.buffer = L.buf; src.playbackRate.value = rate;
      src.connect(this._lg);
      var when = Math.max(ts, now + 0.02), off = Math.max(0, (when - ts) * rate);
      try { src.start(when, off); src.stop(ts + sec + 0.05); } catch (e) {}
      this._ls.push(src);
      if (this._ls.length > 10) this._ls.shift();
    }
    this._lk = (this._lk || 0) + 1;
  }
};
Engine.prototype.stop = function () {
  this._sfTk = (this._sfTk || 0) + 1;
  this.stopLoopSrcs();
  var self0 = this; setTimeout(function () { if (!self0.playing) self0.sfExprTeardown(); }, 400);
  this.playing = false;
  if (this.timer) { clearInterval(this.timer); this.timer = null; }
  if (this.raf) { cancelAnimationFrame(this.raf); this.raf = null; }
  if (this.master && this.ctx && this.ctx.state !== "closed") {
    try { this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.02); } catch (e) {}
    var m = this.master, self = this;
    setTimeout(function () { if (self.master === m) { try { m.gain.value = 0.92; } catch (e) {} } }, 130);
  }
};

function hz(p) { return 440 * Math.pow(2, (p - 69) / 12); }
function pickNear(list, p) {
  var best = 0, bd = 999, i;
  for (i = 0; i < list.length; i++) { var d = Math.abs(list[i] - p); if (d < bd) { bd = d; best = i; } }
  return best;
}

Engine.prototype.play1 = function (buf, when, rate, gain, out, lp, dur, hp) {
  var ctx = this.ctx;
  var src = ctx.createBufferSource();
  src.buffer = buf; src.playbackRate.value = rate;
  var node = src;
  if (lp === -1) lp = 0;                 /* 省いてよい指定 */
  if (lp) {
    var f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = lp; f.Q.value = 0.7;
    src.connect(f); node = f;
  }
  if (hp) {
    var f2 = ctx.createBiquadFilter(); f2.type = "highpass"; f2.frequency.value = hp;
    node.connect(f2); node = f2;
  }
  var g = ctx.createGain();
  g.gain.setValueAtTime(gain, when);
  if (dur) {
    g.gain.setValueAtTime(gain, when + Math.max(0.02, dur - 0.03));
    g.gain.exponentialRampToValueAtTime(0.0008, when + dur + 0.05);
  }
  node.connect(g); g.connect(out);
  src.start(when);
  src.stop(when + (dur ? dur + 0.12 : buf.duration / rate + 0.02));
  return src;
};

/* 鍵盤：ピアノ／エレピ／オルガン／チェンバロ */
/* トーンホイール・オルガン：ドローバー（16'〜1'）・キークリック・
   パーカッション（2nd/3rd の減衰音）・レスリー（回転による揺れ）。伸ばした音ほど効く。 */
Engine.prototype.organBank = function () {
  if (this._wb) return this._wb;
  var ctx = this.ctx, i, b = { buf: [], pitch: [] };
  var ratio = [0.5, 1, 2, 3, 4], draw = [0.55, 1.0, 0.62, 0.26, 0.22];
  for (i = 40; i <= 88; i += 4) {
    b.buf.push(wheelBuf(ctx, 440 * Math.pow(2, (i - 69) / 12), ratio, draw));
    b.pitch.push(i);
  }
  this._wb = b;
  return b;
};
Engine.prototype.organBank = function () {
  if (this._orgB) return this._orgB;
  var ctx = this.ctx, b = { buf: [], pitch: [] }, i;
  for (i = 36; i <= 96; i += 4) {
    b.buf.push(organBuf(ctx, 440 * Math.pow(2, (i - 69) / 12), this.thin ? 0.8 : 1.4));
    b.pitch.push(i);
  }
  this._orgB = b;
  return b;
};
/* ドローバーの組み合わせの、バンク（必要になったときに作る） */
Engine.prototype.organBankSet = function (ix) {
  if (!ix) return this.organBank();
  this._orgBv = this._orgBv || {};
  if (this._orgBv[ix]) return this._orgBv[ix];
  var ctx = this.ctx, b = { buf: [], pitch: [] }, i;
  for (i = 36; i <= 96; i += 4) { b.buf.push(organBuf(ctx, 440 * Math.pow(2, (i - 69) / 12), this.thin ? 0.8 : 1.4, ix)); b.pitch.push(i); }
  this._orgBv[ix] = b;
  return b;
};
/* いまの時刻（曲の拍）に合う、ドローバーの組み合わせ。オルガンの掛け合いの曲だけ：頭＝0、2コーラス目＝1、3コーラス目以降＝2 */
Engine.prototype.drawSetAt = function (when) {
  var so = this.song, o = so && so.opt;
  if (!o || !(o.orgBass || o.orgTrade) || !so.sections) return 0;
  var beat = (when - this.t0) / this.spb, i, ord = -1, hit = null;
  for (i = 0; i < so.sections.length; i++) {
    var sc = so.sections[i];
    if (sc.kind === "solo") ord++;
    if (beat >= sc.at - 1e-6 && beat < sc.at + sc.beats - 1e-6) { hit = sc; break; }
  }
  if (!hit || hit.kind !== "solo") return 0;
  return Math.min(2, ord);
};
/* レスリー（回転スピーカー）：オルガンの伴奏・ソロに、遅い回転→速い回転（2コーラス目以降のソロ）の揺れを掛ける */
Engine.prototype.rotarySetup = function (startSec) {
  var R = this._rot, so = this.song, o = so && so.opt, k, on = !!(o && (o.orgBass || o.orgTrade));
  if (!R) return;
  var now = this.ctx.currentTime, i, ord = -1, spb = this.spb, self = this;
  for (k in R) {
    var r = R[k];
    try {
      r.wet.gain.cancelScheduledValues(now); r.dry.gain.cancelScheduledValues(now); r.lfo.frequency.cancelScheduledValues(now); r.amp.gain.cancelScheduledValues(now);
      r.wet.gain.value = on ? 0.5 : 0; r.dry.gain.value = on ? 0.75 : 1;
      r.lfo.frequency.value = 0.9; r.amp.gain.value = 0.0013;
      if (on && so.sections) {
        ord = -1;
        so.sections.forEach(function (sc) {
          if (sc.kind === "solo") ord++;
          var fast = (sc.kind === "solo" && ord >= 1) ? 1 : 0, tt = self.t0 + sc.at * spb;
          if (tt < now) { if (fast && sc.at * spb + sc.beats * spb > startSec) { r.lfo.frequency.setValueAtTime(6.4, now); r.amp.gain.setValueAtTime(0.0007, now); } return; }
          r.lfo.frequency.setTargetAtTime(fast ? 6.4 : 0.9, tt, 0.6);
          r.amp.gain.setTargetAtTime(fast ? 0.0007 : 0.0013, tt, 0.6);
        });
      }
    } catch (x) {}
  }
};
Engine.prototype.tonewheel = function (p, when, dur, vel, out, level, withPerc) {
  /* 作り置きの波形を繰り返して鳴らす（発振器を毎回作らない＝速い曲でも軽い） */
  var ctxO = this.ctx, vO = Math.max(0.03, Math.min(1, vel / 127));
  var bk = this.organBankSet(this.drawSetAt(when)), gi = pickNear(bk.pitch, p);
  var src = ctxO.createBufferSource();
  src.buffer = bk.buf[gi]; src.loop = true;
  src.playbackRate.value = Math.pow(2, (p - bk.pitch[gi]) / 12);
  var hdO = Math.max(0.12, dur), pkO = 0.26 * vO * (level == null ? 1 : level);
  var gO = ctxO.createGain();
  gO.gain.setValueAtTime(0.0001, when);
  gO.gain.linearRampToValueAtTime(pkO, when + 0.02);
  gO.gain.linearRampToValueAtTime(pkO * (hdO > 0.9 ? 1.06 : 1), when + hdO);
  gO.gain.linearRampToValueAtTime(0.0001, when + hdO + 0.07);
  src.connect(gO); gO.connect(out);
  src.start(when); src.stop(when + hdO + 0.12);
  if (withPerc && this.curKind !== "comp" && !(this.busy >= 1)) {
    /* パーカッション（3倍音の減衰音）とキークリックは、混んでいないときだけ */
    var po = ctxO.createOscillator(); po.type = "sine"; po.frequency.value = hz(p) * 3;
    var pg = ctxO.createGain();
    pg.gain.setValueAtTime(0.05 * vO, when);
    pg.gain.exponentialRampToValueAtTime(0.0005, when + 0.2);
    po.connect(pg); pg.connect(out); po.start(when); po.stop(when + 0.26);
    /* キー・クリック：強く弾くほど目立つ（強弱の2乗） */
    if (this.bank && this.bank.drum && vO > 0.35) this.play1(this.bank.drum.ghost, when, 3, 0.05 * vO * vO, out, 6500, 0.02, 2600);
  }
  return;
};
Engine.prototype.tonewheelOld = function (p, when, dur, vel, out, level, withPerc) {
  var ctx = this.ctx, v = Math.max(0.03, Math.min(1, vel / 127));
  level = level == null ? 1 : level;
  var hd = Math.max(0.12, dur), pk = 0.115 * v * level;
  var lvW = Math.max(this.busy || 0, this.loadLevel ? this.loadLevel(when, 5) : 0);
  var wb = this.organBank();
  var gi = pickNear(wb.pitch, p);
  var src = ctx.createBufferSource();
  src.buffer = wb.buf[gi];
  src.loop = true;                                    /* 定常音なので繰り返して伸ばす */
  src.playbackRate.value = Math.pow(2, (p - wb.pitch[gi]) / 12);
  var g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, when);
  g.gain.linearRampToValueAtTime(pk, when + 0.02);
  g.gain.linearRampToValueAtTime(pk * (hd > 0.9 ? 1.06 : 1), when + hd);
  g.gain.linearRampToValueAtTime(0.0001, when + hd + 0.07);
  src.connect(g); g.connect(out);
  src.start(when); src.stop(when + hd + 0.12);
  /* レスリー：伸ばした音だけ、混んでいないときだけ揺らす */
  if (hd > 0.7 && lvW < 1) {
    try {
      var lfo = ctx.createOscillator(), la = ctx.createGain();
      lfo.type = "sine";
      lfo.frequency.setValueAtTime(0.8, when);
      lfo.frequency.linearRampToValueAtTime(5.6, when + hd * 0.7);
      la.gain.value = 0.16 * pk;
      lfo.connect(la); la.connect(g.gain);
      lfo.start(when); lfo.stop(when + hd + 0.1);
    } catch (e) {}
  }
  if (withPerc && lvW < 2) {
    /* パーカッション（アタックの3倍音）とキークリック */
    if (lvW < 1) {
      var po = ctx.createOscillator(); po.type = "sine"; po.frequency.value = hz(p) * 3;
      var pg = ctx.createGain();
      pg.gain.setValueAtTime(0.055 * v * level, when);
      pg.gain.exponentialRampToValueAtTime(0.0005, when + 0.22);
      po.connect(pg); pg.connect(out); po.start(when); po.stop(when + 0.3);
    }
    if (this.bank && this.bank.drum && lvW < 1) {
      this.play1(this.bank.drum.ghost, when, 3, 0.028 * v * level, out, 6500, 0.02, 2600);
    }
  }
};

Engine.prototype.keysVoice = function (p, when, dur, vel, out, kindK) {
  var ctx = this.ctx, f = hz(p), v = Math.max(0.03, Math.min(1, vel / 127)), i;
  if (kindK === "organ") { this.tonewheel(p, when, dur, vel, out, 1, true); return; }
  /* ピアノ／エレピ／チェンバロ：倍音を重ねて速く減衰させる */
  var lvK = Math.max(this.busy || 0, this.loadLevel ? this.loadLevel(when, 5) : 0);
  if (this.curKind === "comp") lvK = Math.max(lvK, 1);   /* 和音の伴奏は倍音を減らす */
  var harm = kindK === "harpsi" ? [1, 2, 3, 4, 5] : [1, 2, 3, 4.1];
  var amp = kindK === "harpsi" ? [1, 0.7, 0.45, 0.3, 0.18] : [1, 0.42, 0.2, 0.08];
  /* 混んできたら倍音を減らす（和音で重なるので聴こえ方はほぼ変わらない） */
  if (lvK >= 2) { harm = harm.slice(0, 2); amp = amp.slice(0, 2); }
  else if (lvK >= 1) { harm = harm.slice(0, 2); amp = amp.slice(0, 2); }
  var dec = kindK === "harpsi" ? 0.55 : (kindK === "ep" ? 1.6 : 1.05);
  var kg = ctx.createGain();
  kg.gain.setValueAtTime(0.0001, when);
  kg.gain.exponentialRampToValueAtTime(0.18 * v, when + 0.006);
  kg.gain.exponentialRampToValueAtTime(0.0008, when + Math.min(dur + 0.6, dec * (1.6 - v * 0.5)));
  var lp = ctx.createBiquadFilter(); lp.type = "lowpass";
  lp.frequency.value = 900 + 5200 * v * v;
  kg.connect(lp); lp.connect(out);
  for (i = 0; i < harm.length; i++) {
    var o2 = ctx.createOscillator();
    o2.type = (i === 0) ? "triangle" : "sine";
    o2.frequency.value = f * harm[i] * (1 + (Math.random() - 0.5) * 0.0015);
    var g3 = ctx.createGain(); g3.gain.value = amp[i];
    o2.connect(g3); g3.connect(kg); o2.start(when); o2.stop(when + dur + 0.9);
  }
  if (lvK < 1) this.play1(this.bank.drum.ghost, when, 2.4, 0.045 * v, out, 7000, 0.025, 2200);
};
/* 管：サックス／トランペット。息で立ち上げて伸ばす */
Engine.prototype.blownVoice = function (p, when, dur, vel, out) {
  var ctx = this.ctx, f = hz(p), v = Math.max(0.05, Math.min(1, vel / 127));
  var o = ctx.createOscillator(); o.type = "sawtooth";
  o.frequency.setValueAtTime(f * 0.985, when);                 /* 立ち上がりでわずかにしゃくる */
  o.frequency.exponentialRampToValueAtTime(f, when + 0.035);
  var lp = ctx.createBiquadFilter(); lp.type = "lowpass";
  lp.frequency.setValueAtTime(700, when);
  lp.frequency.linearRampToValueAtTime(1400 + 2600 * v, when + 0.05);
  lp.frequency.linearRampToValueAtTime(1100 + 1800 * v, when + Math.max(0.1, dur));
  lp.Q.value = 1.2;
  var lvB = Math.max(this.busy || 0, this.loadLevel ? this.loadLevel(when, 5) : 0);
  var g = ctx.createGain(), hold = Math.max(0.12, dur), pk = 0.23 * v + 0.015;
  g.gain.setValueAtTime(0.0001, when);
  g.gain.linearRampToValueAtTime(pk, when + 0.05);
  g.gain.linearRampToValueAtTime(pk * 0.9, when + hold);          /* 息が続くあいだ保つ */
  g.gain.linearRampToValueAtTime(0.0001, when + hold + 0.08);
  var tail = lp;
  if (this.real !== false) {
    /* 管の胴の共鳴（ホルマント）：サックスやトランペットらしい2つの山 */
    var fm1 = ctx.createBiquadFilter(); fm1.type = "peaking"; fm1.frequency.value = 1050 + 250 * v; fm1.Q.value = 1.4; fm1.gain.value = 5;
    var fm2 = ctx.createBiquadFilter(); fm2.type = "peaking"; fm2.frequency.value = 2500; fm2.Q.value = 2.0; fm2.gain.value = 3;
    lp.connect(fm1); fm1.connect(fm2); tail = fm2;
    o.detune.value = (Math.random() - 0.5) * 8;
  }
  tail.connect(g); g.connect(out);
  o.start(when); o.stop(when + dur + 0.2);
  /* 息の音（混んでいるときは省く） */
  if (lvB < 1 && dur > 0.35) this.play1(this.bank.drum.ghost, when, 1.2, 0.05 * v, out, 4000, Math.min(0.12, dur), 1200);
  /* 伸ばす音のビブラート */
  if (dur > 0.8 && lvB < 1) {
    if (lvB < 1 && dur > 0.5) try {
      var lfo = ctx.createOscillator(), lg = ctx.createGain();
      lfo.frequency.value = 5.4 + Math.random() * 0.6;
      if (this.real !== false) { lg.gain.setValueAtTime(0, when + 0.2); lg.gain.linearRampToValueAtTime(f * 0.007, when + 0.2 + Math.min(0.5, dur * 0.5)); }   /* ビブラートは遅れて、だんだん深く */
      else lg.gain.value = f * 0.006;
      lfo.connect(lg); lg.connect(o.frequency);
      lfo.start(when + 0.22); lfo.stop(when + dur + 0.1);
    } catch (e) {}
  }
};
/* 負荷の段階：0=そのまま 1=飾りを省く 2=芯だけ鳴らす */
/* 飾りの層（共鳴・胴鳴り・仲間の声など）の予算：1秒あたり最大 EXTRA_MAX 個まで。軽量モードでは出さない。
   音切れ（処理が間に合わない）を避けるための上限で、基本の音は減らさない */
var EXTRA_MAX = 18;
Engine.prototype.extra = function (when) {
  if (this.thin || this._noExtra) return false;
  var slot = Math.floor(when);
  if (this._exSlot !== slot) { this._exSlot = slot; this._exN = 0; }
  if (this._exN >= EXTRA_MAX) return false;
  this._exN++;
  return true;
};
Engine.prototype.loadLevel = function (when, add) {
  /* 1秒あたりに作った音の部品の数で段階を決める（詰まってきたら飾りを省く） */
  var slot = Math.floor(when);
  if (this._lvSlot !== slot) {
    this._lvPrev = this._lvN || 0;
    this._lvSlot = slot; this._lvN = 0;
  }
  this._lvN = (this._lvN || 0) + (add || 0);
  var n = Math.max(this._lvN, (this._lvPrev || 0) * 0.85);
  return n > 175 ? 2 : (n > 115 ? 1 : 0);
};
/* ---------- オーケストラの音（映画音楽用）----------
   弦：帯域を絞ったノコギリ波を2本わずかにずらして重ね（合奏のうねり）、ゆっくり立ち上げて余韻を残す。
   ホルン：丸いフィルタで倍音を抑えた柔らかい金管。木管（フルート）：正弦波に息の雑音。
   リード（ハーモニカ・オーボエ）：細いパルス波を鼻にかかった帯域で。ハープ：倍音の減衰をずらした撥弦。
   ティンパニ：低い正弦波の打撃（打った瞬間に少し高く）と皮の雑音。
   ビブラートは曲の中で1本の揺れを全部の音で共有する（1音ごとに作らない＝軽い） */
function orchWaves(ctx) {
  function wave(fn, n) {
    var re = new Float32Array(n + 1), im = new Float32Array(n + 1), k;
    for (k = 1; k <= n; k++) im[k] = fn(k);
    return ctx.createPeriodicWave(re, im);
  }
  return {
    saw: wave(function (k) { return 1 / k; }, 28),
    horn: wave(function (k) { return Math.pow(k, -1.6) * (k % 2 ? 1 : 0.55); }, 16),
    reed: wave(function (k) { return (k % 2 ? 1 : 0.35) / Math.pow(k, 0.9); }, 22),
    clar: wave(function (k) { return (k % 2 ? 1 : 0.06) / Math.pow(k, 1.05); }, 20),
    flute: wave(function (k) { return k === 1 ? 1 : (k === 2 ? 0.18 : (k === 3 ? 0.06 : 0)); }, 4)
  };
}
Engine.prototype.orchVib = function () {
  var ctx = this.ctx;
  if (this._vib && this._vibCtx === ctx) return this._vib;
  var lfo = ctx.createOscillator(); lfo.frequency.value = 5.4;
  var amt = ctx.createGain(); amt.gain.value = 9;                /* ±9セント */
  lfo.connect(amt); lfo.start();
  this._vib = amt; this._vibCtx = ctx;
  return amt;
};
/* 同時に鳴っている発振器の数（終了時刻の一覧から数える）。多いときは合奏の厚み（2本ずらし）や高い倍音を省いて軽くする */
Engine.prototype.orchActive = function (when, add) {
  var a = this._oa || (this._oa = []), n = 0, i, w = [];
  for (i = 0; i < a.length; i++) if (a[i] > when) { w.push(a[i]); n++; }
  this._oa = w;
  return n;
};
Engine.prototype.orchNote = function (endAt, n) { var a = this._oa || (this._oa = []), i; for (i = 0; i < n; i++) a.push(endAt); };
Engine.prototype.orchVoice = function (kind, p, when, dur, vel, out, inst) {
  var ctx = this.ctx, f = hz(p), v = Math.max(0.05, Math.min(1, vel / 127));
  var act = this.orchActive(when), busy = this.thin || act > 26;      /* 同時に26本を超えたら軽くする */
  if (!this._ow || this._owCtx !== ctx) { this._ow = orchWaves(ctx); this._owCtx = ctx; }
  var W = this._ow;
  if (kind === "harp") {
    /* 撥弦：基音と2倍音・3倍音を少しずつ速く減衰させる */
    var ring = Math.min(3.2, 1.2 + 60 / Math.max(40, p)), hs = [[1, 1, ring], [2, 0.32, ring * 0.55], [3, 0.12, ring * 0.35]], zh;
    if (busy) hs.length = 2;
    this.orchNote(when + ring, hs.length);
    for (zh = 0; zh < hs.length; zh++) {
      var oh = ctx.createOscillator(); oh.type = "sine"; oh.frequency.value = f * hs[zh][0];
      var gh = ctx.createGain(), pk = 0.16 * v * hs[zh][1];
      gh.gain.setValueAtTime(0.0001, when);
      gh.gain.exponentialRampToValueAtTime(pk + 0.0002, when + 0.004);
      gh.gain.exponentialRampToValueAtTime(0.0001, when + hs[zh][2]);
      oh.connect(gh); gh.connect(out); oh.start(when); oh.stop(when + hs[zh][2] + 0.05);
    }
    return;
  }
  if (kind === "timp") {
    var ot = ctx.createOscillator(); ot.type = "sine";
    ot.frequency.setValueAtTime(f * 1.04, when); ot.frequency.exponentialRampToValueAtTime(f, when + 0.08);
    var gt = ctx.createGain(), dk = 0.9 + v * 0.8;
    gt.gain.setValueAtTime(0.0001, when);
    gt.gain.exponentialRampToValueAtTime(0.55 * v + 0.02, when + 0.006);
    gt.gain.exponentialRampToValueAtTime(0.0001, when + dk);
    ot.connect(gt); gt.connect(out); ot.start(when); ot.stop(when + dk + 0.05);
    if (this.bank && this.bank.drum && this.bank.drum.ghost) this.play1(this.bank.drum.ghost, when, 0.55, 0.06 * v, out, 900, 0.08);
    return;
  }
  if (inst === "choir") {
    /* 合唱（「アー」）：のこぎり波を2つの帯域（母音の響き）に通し、ゆっくり立ち上げる */
    var oC = ctx.createOscillator(); oC.setPeriodicWave(W.saw); oC.frequency.value = f;
    var bp1 = ctx.createBiquadFilter(); bp1.type = "bandpass"; bp1.frequency.value = 720; bp1.Q.value = 5;
    var bp2 = ctx.createBiquadFilter(); bp2.type = "bandpass"; bp2.frequency.value = 1150; bp2.Q.value = 6;
    var gC = ctx.createGain(), lvC = 0.5 * (0.35 + 0.75 * v), endC = when + Math.max(0.3, dur);
    gC.gain.setValueAtTime(0.0001, when); gC.gain.linearRampToValueAtTime(lvC, when + 0.28);
    gC.gain.setValueAtTime(lvC, endC); gC.gain.linearRampToValueAtTime(0.0001, endC + 0.5);
    oC.connect(bp1); oC.connect(bp2); bp1.connect(gC); bp2.connect(gC); gC.connect(out); oC.start(when); oC.stop(endC + 0.55);
    return;
  }
  if (inst === "hpsi" || inst === "pizz") {
    /* はじく音：チェンバロは明るく速く減衰、ピチカートは丸く短く */
    var oP = ctx.createOscillator(); oP.setPeriodicWave(W.saw); oP.frequency.value = f;
    var fP = ctx.createBiquadFilter(); fP.type = "lowpass"; fP.frequency.value = (inst === "hpsi") ? 5200 : 1100; fP.Q.value = 0.8;
    var gP = ctx.createGain(), decP = (inst === "hpsi") ? 1.1 : 0.45, pkP = (inst === "hpsi" ? 0.07 : 0.22) * (0.4 + 0.7 * v);
    gP.gain.setValueAtTime(0.0001, when);
    gP.gain.exponentialRampToValueAtTime(pkP, when + 0.003);
    gP.gain.exponentialRampToValueAtTime(0.0001, when + decP);
    oP.connect(fP); fP.connect(gP); gP.connect(out); oP.start(when); oP.stop(when + decP + 0.05);
    return;
  }
  /* 持続する楽器：弦（旋律・和音・低音）、ホルン、トランペット、フルート、リード */
  var type = inst || (kind === "horn" ? "horn" : "strings");
  var shortStr = (type === "strShort");
  if (shortStr) type = "strings";
  var wv = (type === "horn") ? W.horn : (type === "flute") ? W.flute : (type === "reed") ? W.reed : (type === "clar") ? W.clar : W.saw;
  var nOsc = (type === "strings" && kind !== "bass" && !shortStr && !(busy && kind === "comp")) ? 2 : 1;
  var att = shortStr ? 0.015 : (type === "brass") ? 0.035 : (kind === "comp") ? 0.55 : (kind === "bass") ? 0.12 : (type === "horn") ? 0.09 : (type === "flute") ? 0.07 : (type === "reed") ? 0.04 : (type === "clar") ? 0.05 : 0.16;
  var rel = shortStr ? 0.12 : (type === "brass") ? 0.2 : (kind === "comp") ? 0.9 : (type === "flute" || type === "reed" || type === "clar") ? 0.18 : 0.55;
  var cut = (type === "brass") ? (kind === "trb" ? 900 + 2200 * v : 1800 + 3400 * v) : (type === "horn") ? 700 + 1500 * v : (type === "flute") ? 5000
    : (type === "reed") ? (kind === "bsn" ? 650 + 900 * v : 1800 + 1600 * v) : (type === "clar") ? 1400 + 2200 * v
    : (kind === "comp") ? 1300 + 1100 * v : (kind === "bass") ? 650 + 500 * v : 2300 + 2600 * v;
  var lp = ctx.createBiquadFilter(); lp.type = (type === "reed") ? "bandpass" : "lowpass";
  lp.frequency.value = cut; lp.Q.value = (type === "reed") ? 0.9 : 0.6;
  var g = ctx.createGain(), hold = Math.max(0.1, dur);
  var lvl = ((shortStr ? 0.06 : (type === "brass") ? 0.12 : 0) || ((kind === "comp") ? 0.07 : (kind === "bass") ? 0.2 : (type === "horn") ? 0.14 : (type === "flute") ? 0.2 : (type === "reed") ? 0.11 : (type === "clar") ? 0.12 : 0.1)) * (0.35 + 0.75 * v);
  g.gain.setValueAtTime(0.0001, when);
  g.gain.linearRampToValueAtTime(lvl, when + att);
  g.gain.setValueAtTime(lvl, when + Math.max(att, hold));
  g.gain.exponentialRampToValueAtTime(0.0001, when + Math.max(att, hold) + rel);
  lp.connect(g); g.connect(out);
  var vib = (kind === "mel" || kind === "solo" || kind === "horn" || kind === "cello" || kind === "fl" || kind === "ob") ? this.orchVib() : null, zo;
  for (zo = 0; zo < nOsc; zo++) {
    var o = ctx.createOscillator(); o.setPeriodicWave(wv); o.frequency.value = f;
    o.detune.value = nOsc > 1 ? (zo ? 7 : -7) : 0;
    if (vib) vib.connect(o.detune);
    o.connect(lp); o.start(when); o.stop(when + Math.max(att, hold) + rel * 0.85 + 0.03);          /* 音量が下がりきる少し前に止める（発振器の数を減らす） */
  }
  this.orchNote(when + Math.max(att, hold) + rel * 0.85 + 0.03, nOsc);
  if (type === "flute") {
    /* 息の雑音を少し */
    if (this.bank && this.bank.drum && this.bank.drum.ghost) this.play1(this.bank.drum.ghost, when, 2.2, 0.02 * v, out, 5000, Math.min(0.25, hold));
  }
};

/* ファミコン風の音：矩形波（デューティ比 12.5％・25％・50％）、三角波、ノイズ */
Engine.prototype.chipWave = function (duty) {
  this._chipW = this._chipW || {};
  if (this._chipW[duty]) return this._chipW[duty];
  var N = 40, re = new Float32Array(N + 1), im = new Float32Array(N + 1), n;
  for (n = 1; n <= N; n++) { re[n] = Math.sin(2 * Math.PI * n * duty) / (n * Math.PI); im[n] = (1 - Math.cos(2 * Math.PI * n * duty)) / (n * Math.PI); }
  return (this._chipW[duty] = this.ctx.createPeriodicWave(re, im));
};
Engine.prototype.chipNoiseBuf = function () {
  if (this._chipN) return this._chipN;
  var ctx = this.ctx, len = Math.floor(ctx.sampleRate), b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0), i, r = 12345;
  for (i = 0; i < len; i++) { r = (r * 1103515245 + 12345) & 0x7fffffff; d[i] = (r / 0x3fffffff) - 1; }
  return (this._chipN = b);
};
Engine.prototype.chipVoice = function (kind, p, when, dur, vel, out) {
  var ctx = this.ctx, v = Math.max(0.05, Math.min(1, vel / 127)), f = 440 * Math.pow(2, (p - 69) / 12);
  if (kind === "drums" || kind === "perc" || kind === "perc2" || kind === "perc3") {
    var isKick = (p === 35 || p === 36), isTom = [41, 43, 45, 47, 48, 50].indexOf(p) >= 0;
    if (isKick || isTom) {
      var o = ctx.createOscillator(); o.type = "triangle";
      var f0 = isKick ? 150 : 90 + (p - 41) * 12;
      o.frequency.setValueAtTime(f0, when); o.frequency.exponentialRampToValueAtTime(isKick ? 45 : f0 * 0.5, when + 0.12);
      var g = ctx.createGain(); g.gain.setValueAtTime(0.0001, when); g.gain.exponentialRampToValueAtTime(0.5 * v, when + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, when + 0.16);
      o.connect(g); g.connect(out); o.start(when); o.stop(when + 0.2); return;
    }
    var hi = [42, 44, 46, 51, 53, 59].indexOf(p) >= 0, crash = [49, 57, 55].indexOf(p) >= 0;
    var src = ctx.createBufferSource(); src.buffer = this.chipNoiseBuf();
    var fl = ctx.createBiquadFilter(); fl.type = (hi || crash) ? "highpass" : "bandpass"; fl.frequency.value = hi ? 7000 : crash ? 4000 : 1800; fl.Q.value = 0.7;
    var dec = hi ? (p === 46 ? 0.18 : 0.045) : crash ? 0.8 : (p === 37 ? 0.05 : 0.13);
    var g2 = ctx.createGain(); g2.gain.setValueAtTime(0.0001, when); g2.gain.exponentialRampToValueAtTime((hi ? 0.18 : crash ? 0.22 : 0.4) * v, when + 0.003); g2.gain.exponentialRampToValueAtTime(0.0001, when + dec);
    src.connect(fl); fl.connect(g2); g2.connect(out); src.start(when, (p % 7) * 0.07); src.stop(when + dec + 0.02); return;
  }
  var o2 = ctx.createOscillator(), g3 = ctx.createGain(), lvl, len = Math.max(0.05, dur);
  if (kind === "bass") { o2.type = "triangle"; lvl = 0.3; }
  else { o2.setPeriodicWave(this.chipWave(kind === "comp" ? 0.125 : 0.5)); lvl = (kind === "comp") ? 0.06 : 0.09; }
  o2.frequency.value = f;
  if ((kind === "mel" || kind === "solo") && len > 0.35) {
    var lf = ctx.createOscillator(), lg = ctx.createGain(); lf.frequency.value = 5.5;
    lg.gain.setValueAtTime(0, when); lg.gain.linearRampToValueAtTime(f * 0.012, when + Math.min(0.35, len * 0.5));
    lf.connect(lg); lg.connect(o2.frequency); lf.start(when); lf.stop(when + len + 0.05);
  }
  var pk = lvl * (0.45 + 0.6 * v);
  g3.gain.setValueAtTime(0.0001, when); g3.gain.exponentialRampToValueAtTime(pk, when + 0.004);
  g3.gain.setValueAtTime(pk, when + Math.max(0.005, len - 0.03)); g3.gain.exponentialRampToValueAtTime(0.0001, when + len + 0.02);
  o2.connect(g3); g3.connect(out); o2.start(when); o2.stop(when + len + 0.05);
};
/* ---------- リアル音源（SoundFont 2）----------
   ユーザーの .sf2 を読み、曲で使う音だけをあらかじめサンプルに展開して、WebAudio で鳴らす。
   音色は MIDI に書き出す stem.prog（GM番号）をそのまま使うので、聴いた音と Cubase に渡るデータが一致する。 */
function sf2Parse(buf) {
  var dv = new DataView(buf), u8 = new Uint8Array(buf);
  function tag(o) { return String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]); }
  function str(o, n) { var s = ""; for (var i = 0; i < n && u8[o + i]; i++) s += String.fromCharCode(u8[o + i]); return s; }
  if (buf.byteLength < 12 || tag(0) !== "RIFF" || tag(8) !== "sfbk") throw new Error("SF2 ファイルではありません");
  var smpl = null, pd = {}, o = 12, end = Math.min(buf.byteLength, 8 + dv.getUint32(4, true));
  while (o + 8 <= end) {
    var id = tag(o), sz = dv.getUint32(o + 4, true);
    if (id === "LIST") {
      var lt = tag(o + 8), p = o + 12, e = Math.min(end, o + 8 + sz);
      while (p + 8 <= e) {
        var cid = tag(p), csz = dv.getUint32(p + 4, true);
        if (lt === "sdta" && cid === "smpl") smpl = { off: p + 8, len: csz };
        else if (lt === "pdta") pd[cid] = { off: p + 8, len: csz };
        p += 8 + csz + (csz & 1);
      }
    }
    o += 8 + sz + (sz & 1);
  }
  if (!smpl || !pd.phdr || !pd.pbag || !pd.pgen || !pd.inst || !pd.ibag || !pd.igen || !pd.shdr) throw new Error("SF2 の構造が読めません");
  if (tag(smpl.off) === "OggS") throw new Error("SF3（圧縮形式）には未対応です。SF2 を使ってください");
  function recs(c, size, fn) { var r = [], n = Math.floor(c.len / size); for (var i = 0; i < n; i++) r.push(fn(c.off + i * size)); return r; }
  var u16 = function (a) { return dv.getUint16(a, true); };
  var genRec = function (a) { return { v: dv.getInt16(a + 2, true), lo: u8[a + 2], hi: u8[a + 3], op: dv.getUint16(a, true) }; };
  var ph = recs(pd.phdr, 38, function (a) { return { name: str(a, 20), prog: u16(a + 20), bank: u16(a + 22), bag: u16(a + 24) }; });
  var pb = recs(pd.pbag, 4, u16), pg = recs(pd.pgen, 4, genRec);
  var ins = recs(pd.inst, 22, function (a) { return { name: str(a, 20), bag: u16(a + 20) }; });
  var ib = recs(pd.ibag, 4, u16), ig = recs(pd.igen, 4, genRec);
  var sh = recs(pd.shdr, 46, function (a) {
    return { name: str(a, 20), start: dv.getUint32(a + 20, true), end: dv.getUint32(a + 24, true), ls: dv.getUint32(a + 28, true),
      le: dv.getUint32(a + 32, true), sr: dv.getUint32(a + 36, true), root: u8[a + 40], pc: dv.getInt8(a + 41), type: u16(a + 44) };
  });
  function zoneGens(bags, gens, i) { var g = {}, a = bags[i], b = bags[i + 1]; for (var k = a; k < b && k < gens.length; k++) g[gens[k].op] = gens[k]; return g; }
  function instZones(ii) {
    var out = [], glob = null;
    for (var z = ins[ii].bag; z < ins[ii + 1].bag; z++) {
      var g = zoneGens(ib, ig, z);
      if (!g[53]) { if (z === ins[ii].bag) glob = g; continue; }
      out.push({ g: g, glob: glob });
    }
    return out;
  }
  function range(a, b) { return [Math.max(a[0], b[0]), Math.min(a[1], b[1])]; }
  function rg(g, gl, op) { var a = g[op] || (gl && gl[op]); return a ? [a.lo, a.hi] : [0, 127]; }
  function mergeZone(q, gl, pz) {
    var s = sh[q.g[53].v];
    if (!s || (s.type & 0x8000) || s.end <= s.start) return null;
    var iv = function (op, def) { var a = q.g[op] || (q.glob && q.glob[op]); return a ? a.v : def; };
    var pv = function (op) { var a = pz[op] || (gl && gl[op]); return a ? a.v : 0; };
    var kr = range(rg(q.g, q.glob, 43), rg(pz, gl, 43)), vr = range(rg(q.g, q.glob, 44), rg(pz, gl, 44));
    if (kr[0] > kr[1] || vr[0] > vr[1]) return null;
    var rk = iv(58, -1);
    return {
      lo: kr[0], hi: kr[1], vlo: vr[0], vhi: vr[1], si: q.g[53].v,
      root: rk >= 0 ? rk : (s.root > 127 ? 60 : s.root),
      tune: (iv(51, 0) + pv(51)) * 100 + iv(52, 0) + pv(52) + s.pc,
      scale: iv(56, 100), att: iv(48, 0) + pv(48), pan: iv(17, 0) + pv(17),
      fc: iv(8, 13500) + pv(8), q: iv(9, 0) + pv(9),
      dly: iv(33, -12000) + pv(33), atk: iv(34, -12000) + pv(34), hold: iv(35, -12000) + pv(35),
      dec: iv(36, -12000) + pv(36), sus: iv(37, 0) + pv(37), rel: iv(38, -12000) + pv(38),
      mode: iv(54, 0) & 3, excl: iv(57, 0),
      so: iv(0, 0) + 32768 * iv(4, 0), eo: iv(1, 0) + 32768 * iv(12, 0),
      lso: iv(2, 0) + 32768 * iv(45, 0), leo: iv(3, 0) + 32768 * iv(50, 0)
    };
  }
  var presets = {}, count = 0;
  for (var pi = 0; pi < ph.length - 1; pi++) {
    var zs = [], gl = null;
    for (var z = ph[pi].bag; z < ph[pi + 1].bag; z++) {
      var pz = zoneGens(pb, pg, z);
      if (!pz[41]) { if (z === ph[pi].bag) gl = pz; continue; }
      if (pz[41].v < 0 || pz[41].v >= ins.length - 1) continue;
      instZones(pz[41].v).forEach(function (q) { var m = mergeZone(q, gl, pz); if (m) zs.push(m); });
    }
    presets[ph[pi].bank * 1000 + ph[pi].prog] = { name: ph[pi].name, bank: ph[pi].bank, prog: ph[pi].prog, zones: zs };
    count++;
  }
  return { presets: presets, count: count, sh: sh, buf: buf, smplOff: smpl.off };
}
function sfFind(sf, bank, prog) {
  var P = sf.presets, r = P[bank * 1000 + prog], k;
  if (r) return r;
  if (bank === 128) {                                  /* ドラムキットが無ければ、あるキットの先頭 */
    r = P[128000]; if (r) return r;
    for (k in P) if (P[k].bank === 128) return P[k];
    return null;
  }
  r = null;
  for (k in P) if (P[k].prog === prog && P[k].bank !== 128) { r = P[k]; if (P[k].bank === 0) break; }
  return r;
}
function sfZones(pr, key, vel) {
  var by = pr.byKey || (pr.byKey = {}), l = by[key];
  if (!l) l = by[key] = pr.zones.filter(function (z) { return key >= z.lo && key <= z.hi; });
  return l.filter(function (z) { return vel >= z.vlo && vel <= z.vhi; });
}
function sfKey(z) { return z.si + "_" + z.so + "_" + z.eo; }
function sfBuild(ctx, sf, z, cache) {
  var k = sfKey(z); if (cache[k]) return cache[k];
  var s = sf.sh[z.si], st = s.start + z.so, n = s.end + z.eo - st;
  if (n < 2 || st < 0) return null;
  var bsr = Math.min(96000, Math.max(8000, s.sr || 44100)), b = ctx.createBuffer(1, n, bsr), d = b.getChannelData(0);
  var off = sf.smplOff + st * 2, i;
  if (off + n * 2 > sf.buf.byteLength) return null;
  var a16 = (off & 1) ? new Int16Array(sf.buf.slice(off, off + n * 2)) : new Int16Array(sf.buf, off, n);
  for (i = 0; i < n; i++) d[i] = a16[i] / 32768;
  var ls = s.ls + z.lso - st, le = s.le + z.leo - st;
  cache[k] = { b: b, rf: (s.sr || bsr) / bsr, bsr: bsr, ls: ls, le: le, loop: z.mode === 1 || z.mode === 3, n: n };
  if (cache[k].loop && !(le > ls + 8 && le <= n && ls >= 0)) cache[k].loop = false;
  return cache[k];
}
var SFStore = {
  open: function () {
    return new Promise(function (res, rej) {
      var r = root.indexedDB.open("hcg-sf", 1);
      r.onupgradeneeded = function () { r.result.createObjectStore("sf"); };
      r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); };
    });
  },
  save: function (name, buf) {
    return SFStore.open().then(function (db) { return new Promise(function (res, rej) {
      var tx = db.transaction("sf", "readwrite"); tx.objectStore("sf").put({ name: name, buf: buf }, "cur");
      tx.oncomplete = function () { res(); }; tx.onerror = function () { rej(tx.error); }; }); });
  },
  load: function () {
    return SFStore.open().then(function (db) { return new Promise(function (res, rej) {
      var q = db.transaction("sf").objectStore("sf").get("cur");
      q.onsuccess = function () { res(q.result || null); }; q.onerror = function () { rej(q.error); }; }); });
  },
  clear: function () {
    return SFStore.open().then(function (db) { return new Promise(function (res) {
      var tx = db.transaction("sf", "readwrite"); tx.objectStore("sf").delete("cur"); tx.oncomplete = function () { res(); }; }); });
  }
};
/* パートごとの音量の倍率（1＝そのまま）。再生中でも、すぐ反映する */
Engine.prototype.setVolMul = function (map) {
  var k; this.volMul = map || {};
  for (k in this.gains) if (this.gains[k] && !this.mute[k]) { try { this.gains[k].gain.value = (MIX[k] ? MIX[k].gain : 1) * (this.volMul[k] || 1); } catch (x) {} }
};
Engine.prototype.sfAttach = function (buf, name) {
  var sf = sf2Parse(buf); sf.name = name || "SF2";
  this.sf = sf; this.sfBuf = {}; this._sfPrepSong = null; this._sfEx = {};
  return sf;
};
Engine.prototype.sfDetach = function () { this.sf = null; this.sfBuf = {}; this.sfOn = false; this._sfPrepSong = null; };
Engine.prototype.sfUse = function () { return !!(this.sfOn && this.sf && !(this.tone && this.tone.chip)); };
Engine.prototype.sfPresetOf = function (kind) {
  var pk = this.sfPick && this.sfPick[kind];                         /* パートごとに選んだ音色（SF2 の中の bank*1000+prog）があれば、それを使う */
  if (pk != null && this.sf && this.sf.presets[pk]) return this.sf.presets[pk];
  if (kind === "drums" || kind === "perc" || kind === "perc2" || kind === "perc3") return sfFind(this.sf, 128, this.sfKit || 0);
  var pg = this.sfProg && this.sfProg[kind] != null ? this.sfProg[kind] : 0;
  return sfFind(this.sf, 0, pg);
};
Engine.prototype.sfPrepare = function (onStatus) {
  var self = this, sf = this.sf, evs = this.evs, need = {}, list = [], i, j, ctx = this.ctx, song = this.song;
  for (i = 0; i < evs.length; i++) {
    var e = evs[i], pr = this.sfPresetOf(e.k); if (!pr) continue;
    var zs = sfZones(pr, Math.max(0, Math.min(127, Math.round(e.p + (e.mic || 0)))), e.v);
    for (j = 0; j < zs.length; j++) { var k = sfKey(zs[j]); if (!this.sfBuf[k] && !need[k]) { need[k] = 1; list.push(zs[j]); } }
  }
  return new Promise(function (res) {
    var n = 0;
    (function step() {
      var t = Date.now();
      while (n < list.length && Date.now() - t < 30) { try { sfBuild(ctx, sf, list[n], self.sfBuf); } catch (x) {} n++; }
      if (onStatus) onStatus(n, list.length);
      if (n < list.length) setTimeout(step, 0);
      else { self._sfPrepSong = song; res(); }
    })();
  });
};
/* ---- 表情（CC11 強弱／CC1 ビブラート／ピッチベンド）を SF2 の再生に反映 ----
   書き出す MIDI と同じ stem.extra を読み、パートごとに ①音量ノード（CC11）②ゆらぎの深さ（CC1）③音程の定数ノード（ベンド）を、
   曲の進行に合わせて自動化する。各音は ②③を自分の detune につなぐ。 */
Engine.prototype.sfCurvesOf = function (song, spb) {
  var cur = {}, i, k;
  for (i = 0; i < song.stems.length; i++) {
    var st = song.stems[i], ex = st.extra || [];
    if (st.id === "drums" || st.id === "perc" || st.id === "perc2" || st.id === "perc3" || !ex.length) continue;
    var c = { cc11: [], cc1: [], bend: [] };
    for (k = 0; k < ex.length; k++) {
      var v = ex[k];
      if (v.bend != null) c.bend.push([v.t * spb, v.bend]);
      else if (v.cc === 11) c.cc11.push([v.t * spb, v.val]);
      else if (v.cc === 1) c.cc1.push([v.t * spb, v.val]);
    }
    c.cc11.sort(function (a, b) { return a[0] - b[0]; }); c.cc1.sort(function (a, b) { return a[0] - b[0]; }); c.bend.sort(function (a, b) { return a[0] - b[0]; });
    cur[st.id] = c;
  }
  return cur;
};
Engine.prototype.sfExprTeardown = function () {
  var m = this._sfMod, k;
  if (m) for (k in m) { try { if (m[k].osc) m[k].osc.stop(); } catch (x) {} try { if (m[k].cs) m[k].cs.stop(); } catch (x) {} }
  this._sfExpr = null; this._sfMod = null;
};
Engine.prototype.sfExprSetup = function (startSec) {
  var ctx = this.ctx, self = this, t0 = this.t0, cur = this.sfCurves || {}, base = ctx.currentTime;
  this.sfExprTeardown();
  this._sfExpr = {}; this._sfMod = {};
  function sched(param, arr, fn, def, smooth) {
    var i = 0, last = null;
    while (i < arr.length && arr[i][0] <= startSec) { last = arr[i]; i++; }
    param.setValueAtTime(fn(last ? last[1] : def), base);
    for (; i < arr.length; i++) { var tt = t0 + arr[i][0]; if (tt > base) param.setTargetAtTime(fn(arr[i][1]), tt, smooth); }
  }
  Object.keys(cur).forEach(function (kind) {
    var c = cur[kind], out = self.gains[kind];
    if (!out) return;
    if (c.cc11.length) {
      var ex = ctx.createGain(); ex.connect(out);
      sched(ex.gain, c.cc11, function (v) { return Math.min(1.3, Math.pow(Math.max(1, v) / 110, 2)); }, 100, 0.04);
      self._sfExpr[kind] = ex;
    }
    var mod = {};
    if (c.cc1.length && !self.thin) {
      var osc = ctx.createOscillator(), dep = ctx.createGain();
      osc.type = "sine"; osc.frequency.value = 5.4; osc.connect(dep);
      sched(dep.gain, c.cc1, function (v) { return Math.max(0, v) / 127 * 45; }, 0, 0.05);
      osc.start(); mod.osc = osc; mod.vib = dep;
    }
    if (c.bend.length && ctx.createConstantSource) {
      var cs = ctx.createConstantSource();
      sched(cs.offset, c.bend, function (v) { return v * 100; }, 0, 0.02);
      cs.start(); mod.cs = cs; mod.bend = cs;
    }
    if (mod.vib || mod.bend) self._sfMod[kind] = mod;
  });
};
Engine.prototype.sfOutFor = function (kind) {
  return (this._sfExpr && this._sfExpr[kind]) || this.gains[kind] || this.gains.mel;
};
Engine.prototype.sfPlay = function (kind, p, when, dur, vel, out) {
  var ctx = this.ctx, drum = (kind === "drums" || kind === "perc" || kind === "perc2" || kind === "perc3"), pr = this.sfPresetOf(kind);
  if (!pr) return false;
  var key = Math.max(0, Math.min(127, Math.round(p))), zs = sfZones(pr, key, vel), any = false, i;
  var vg = Math.pow(Math.max(1, vel) / 127, 1.8) * 0.9;
  var tc = function (x) { return Math.pow(2, Math.max(-12000, Math.min(8000, x)) / 1200); };
  for (i = 0; i < zs.length; i++) {
    var z = zs[i], B = this.sfBuf[sfKey(z)];
    if (!B) continue;
    var tOff = when + Math.max(0.03, dur), d = tc(z.dly), a = Math.max(0.003, tc(z.atk)), h = tc(z.hold);
    var t1 = when + d, t2 = t1 + a;
    if (tOff <= t1) continue;
    var src = ctx.createBufferSource(); src.buffer = B.b;
    src.playbackRate.value = Math.pow(2, ((p - z.root) * z.scale + z.tune) / 1200) * B.rf;
    if (B.loop) { src.loop = true; src.loopStart = B.ls / B.bsr; src.loopEnd = B.le / B.bsr; }
    var md = this._sfMod && this._sfMod[kind];
    if (md && !drum && src.detune) {
      try {
        if (md.vib) md.vib.connect(src.detune);
        if (md.bend) md.bend.connect(src.detune);
        src.onended = (function (s2, m2) { return function () { try { if (m2.vib) m2.vib.disconnect(s2.detune); if (m2.bend) m2.bend.disconnect(s2.detune); } catch (x) {} }; })(src, md);
      } catch (x) {}
    }
    var node = src;
    if (z.fc < 13000) {
      var f = ctx.createBiquadFilter(); f.type = "lowpass";
      f.frequency.value = Math.min(20000, Math.max(80, 8.176 * Math.pow(2, z.fc / 1200)));
      f.Q.value = Math.max(0, Math.min(30, z.q / 10));
      node.connect(f); node = f;
    }
    var g = ctx.createGain(), ga = g.gain, peak = Math.pow(10, -Math.max(0, Math.min(1440, z.att)) / 200) * vg;
    node.connect(g); node = g;
    if (ctx.createStereoPanner) {
      var pn = ctx.createStereoPanner(); pn.pan.value = Math.max(-1, Math.min(1, z.pan / 500));
      node.connect(pn); node = pn;
    }
    node.connect(out);
    var susA = Math.pow(10, -Math.max(0, Math.min(1440, z.sus)) / 200), tD = t2 + h, relOn = !(drum && !B.loop);
    ga.setValueAtTime(0, when);
    if (tOff < t2) { ga.setValueAtTime(0, t1); ga.linearRampToValueAtTime(peak * (tOff - t1) / a, tOff); }
    else {
      ga.setValueAtTime(0, t1); ga.linearRampToValueAtTime(peak, t2);
      if (tOff > tD && susA < 0.98) ga.setTargetAtTime(peak * susA, tD, Math.max(0.01, tc(z.dec) / 11.5));
    }
    src.start(when);
    if (relOn) {
      var tau = Math.max(0.015, tc(z.rel) / 11.5);
      ga.setTargetAtTime(0, tOff, tau);
      try { src.stop(tOff + tau * 7 + 0.05); } catch (x) {}
    }
    if (z.excl) {
      var pe = this._sfEx[z.excl];
      if (pe) { try { pe.g.gain.setTargetAtTime(0, when, 0.008); pe.src.stop(when + 0.1); } catch (x) {} }
      this._sfEx[z.excl] = { g: g, src: src };
    }
    any = true;
  }
  return any;
};
/* ---- インド古典の音色：シタール（ジャワーリー＝びびり音・共鳴弦）、タンプーラ、タブラ、ガタム ---- */
var _sitarCurve = null;
function sitarCurve() {
  if (_sitarCurve) return _sitarCurve;
  var n = 2048, c = new Float32Array(n), i, x, a = 2.6, bias = 0.16, z0 = Math.tanh(a * bias);
  for (i = 0; i < n; i++) { x = (i / (n - 1)) * 2 - 1; c[i] = (Math.tanh(a * (x + bias)) - z0) / Math.tanh(a * (1 + bias)); }
  return (_sitarCurve = c);
}
Engine.prototype.sitarVoice = function (kind, p, when, dur, vel, out, g, gd, ao) {
  var ctx = this.ctx, v = Math.max(0.03, Math.min(1, vel / 127)), tan = (kind === "harp"), b = this.bank;
  this._sb = this._sb || {};
  var bus = this._sb[kind];
  if (!bus) {
    var ws = ctx.createWaveShaper(); ws.curve = sitarCurve(); ws.oversample = "2x";
    var hs = ctx.createBiquadFilter(); hs.type = "highshelf"; hs.frequency.value = 2600; hs.gain.value = tan ? 1 : 7;
    var pk = ctx.createBiquadFilter(); pk.type = "peaking"; pk.frequency.value = tan ? 900 : 3400; pk.Q.value = 1.1; pk.gain.value = tan ? 3 : 5;
    var lpf = ctx.createBiquadFilter(); lpf.type = "lowpass"; lpf.frequency.value = tan ? 3000 : 9000; lpf.Q.value = 0.6;
    var tb = ctx.createBiquadFilter(); tb.type = "peaking"; tb.frequency.value = tan ? 140 : 210; tb.Q.value = 0.9; tb.gain.value = tan ? 2.5 : 3.2;   /* 瓢箪（ツンバ）の胴鳴り */
    var g = ctx.createGain(); g.gain.value = tan ? 0.6 : 0.85;
    ws.connect(hs); hs.connect(pk); pk.connect(lpf); lpf.connect(tb); tb.connect(g); g.connect(out);
    bus = this._sb[kind] = ws;
  }
  var gb = this.gtrBank("steel"), gi = pickNear(gb.pitch, p), r = Math.pow(2, (p - gb.pitch[gi]) / 12);
  var src0 = (gb.buf2.length && Math.random() < 0.5) ? gb.buf2[gi] : gb.buf[gi];
  var len = Math.max(0.3, dur) * (tan ? 1.0 : 1.7);
  var gain = tan ? (0.16 + 0.22 * v) : (0.30 * v + 0.07);
  var daRa = !tan && (this._sitD = !this._sitD);                         /* ミズラーブの往復：ダ（下ろし：強く明るい）／ラ（上げ：軽くやや暗い） */
  if (!tan) gain *= daRa ? 1.0 : 0.82;
  var lead = this.play1(src0, when, r, gain, bus, tan ? 2800 : (daRa ? 7500 : 6200), len);
  if (tan) {                                            /* タンプーラ：ジャワリの倍音が遅れて開き、ゆっくり揺れる（音の「ジーン」） */
    if (this.loadLevel(when, 4) < 2) {
      this.play1(src0, when + 0.16, r * 2.004, gain * 0.34, bus, 5200, len * 0.9);
      this.play1(src0, when + 0.34, r * 3.008, gain * 0.2, bus, 5600, len * 0.8);
      this.play1(src0, when + 0.55, r * 4.011, gain * 0.1, bus, 6000, len * 0.6);
    }
    return;
  }
  try {
    if (g) { lead.playbackRate.setValueAtTime(r * Math.pow(2, g / 12), when); lead.playbackRate.exponentialRampToValueAtTime(r, when + Math.max(0.05, gd || 0.15)); }   /* ミーンド：前の音から滑って入る */
    else { lead.playbackRate.setValueAtTime(r * 1.014, when); lead.playbackRate.exponentialRampToValueAtTime(r, when + 0.045); }
  } catch (x) {}
  if (ao && dur > 0.5) {                                 /* アンドーラン：ゆっくりした音程の揺れ */
    try {
      var lfo = ctx.createOscillator(), lg = ctx.createGain();
      lfo.frequency.value = 5.2 + Math.random() * 0.8; lg.gain.value = r * 0.014;
      lfo.connect(lg); lg.connect(lead.playbackRate); lfo.start(when + 0.25); lfo.stop(when + len + 0.1);
    } catch (x) {}
  }
  var LV = this.loadLevel(when, 4);
  if (LV < 2) {                                         /* 共鳴弦（オクターブと5度） */
    this.play1(src0, when + 0.011, r * 2, gain * 0.17, bus, 5600, len * 0.8);
    this.play1(src0, when + 0.019, r * 1.4983, gain * 0.10, bus, 4400, len * 0.7);
  }
  if (LV < 1 && dur > 0.35 && this.extra(when)) {       /* ジャワリ：橋に弦が触れてうなる。倍音が遅れて開き、わずかにずれて揺れる */
    this.play1(src0, when + 0.045, r * 2.006, gain * 0.13, bus, 9000, len * 0.6);
    this.play1(src0, when + 0.09, r * 3.01, gain * 0.06, bus, 8800, len * 0.45);
    this.play1(src0, when + 0.024, r * 0.5, gain * 0.07, bus, 2600, len * 0.9);          /* 共鳴弦（タラフ）の低い鳴り */
  }
  if (LV < 1 && v > 0.4) this.play1(b.drum.ghost, when, 2.4, 0.07 * v, out, 9500, 0.03, 3200);   /* ミズラーブが弦を弾く音 */
  if (LV < 1 && dur > 0.7 && Math.random() < 0.4 && this.extra(when)) {     /* チカリ：高い2本のドローン弦を指で弾く（旋律の合間に、高い Sa が軽く鳴る） */
    var sa = ((this.song && this.song.indian && this.song.indian.saMidi) || 57) + 24;
    var ci = pickNear(gb.pitch, sa), cr = Math.pow(2, (sa - gb.pitch[ci]) / 12);
    this.play1(gb.buf[ci], when + dur * (0.45 + Math.random() * 0.3), cr, gain * 0.13, bus, 6500, 0.9);
  }
};
/* タブラ：皮と胴の鳴り（低い谷・皮の張り・初期反射）。全ストロークで1本を共有 */
Engine.prototype.tablaBus = function (out) {
  if (this._tbb) return this._tbb;
  var ctx = this.ctx, inn = ctx.createGain();
  function pk(f, q, g, type) { var bq = ctx.createBiquadFilter(); bq.type = type || "peaking"; bq.frequency.value = f; bq.Q.value = q; bq.gain.value = g; return bq; }
  var hp = pk(70, 0.7, 0, "highpass"), a = pk(170, 1.0, 2.2), b2 = pk(520, 1.0, -1.5), c = pk(3400, 0.9, 2.0), d = pk(9000, 0.7, -2.5, "highshelf");
  inn.connect(hp); hp.connect(a); a.connect(b2); b2.connect(c); c.connect(d); d.connect(out);
  try {
    var dl = ctx.createDelay(0.05), dg = ctx.createGain(), dl2 = ctx.createDelay(0.05), dg2 = ctx.createGain();
    dl.delayTime.value = 0.0097; dg.gain.value = 0.10; dl2.delayTime.value = 0.0213; dg2.gain.value = 0.06;
    d.connect(dl); dl.connect(dg); dg.connect(out); d.connect(dl2); dl2.connect(dg2); dg2.connect(out);
  } catch (x) {}
  return (this._tbb = inn);
};
Engine.prototype.tablaHit = function (p, when, v, out) {
  out = this.tablaBus(out);
  var ctx = this.ctx, b = this.bank, sm = (this.song && this.song.indian && this.song.indian.saMidi) || 57;
  var f = 440 * Math.pow(2, (sm - 69) / 12);
  while (f < 150) f *= 2;
  while (f > 300) f /= 2;
  var fb = f * 0.62, dj = 1 + (Math.random() - 0.5) * 0.012;                    /* 毎回わずかに違う（皮の張りと叩く位置） */
  f *= dj;
  function osc(fr, f1, t1, f2, dec, gn) {
    var o = ctx.createOscillator(); o.type = "sine";
    o.frequency.setValueAtTime(fr, when);
    if (f1) o.frequency.linearRampToValueAtTime(f1, when + t1);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, when + dec * 0.9);
    var g = ctx.createGain(); g.gain.setValueAtTime(0.0001, when); g.gain.linearRampToValueAtTime(gn * v, when + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0008, when + dec);
    o.connect(g); g.connect(out); o.start(when); o.stop(when + dec + 0.03);
  }
  var LVt = this.loadLevel ? this.loadLevel(when, 3) : 0, rich = LVt < 1 && this.extra(when);
  if (p === 64) {                                       /* バヤン（ゲ）：手首の圧で音程が上がって沈む。膜の高次モード（1.59・2.14）がかすかに */
    var up = 1.18 + 0.1 * v;
    osc(fb * 0.88, fb * up, 0.05, fb * 0.88, 0.5, 0.60);
    if (rich) { osc(fb * 1.59, fb * 1.7, 0.04, fb * 1.5, 0.18, 0.08); osc(fb * 2.14, 0, 0, 0, 0.1, 0.04); }
    this.play1(b.drum.ghost, when, 0.55, 0.15 * v, out, 900, 0.05);
    if (rich) this.play1(b.drum.ghost, when, 1.1, 0.05 * v, out, 2400, 0.012, 1000);        /* 手のひらの当たり */
  } else if (p === 63) {                                /* ダヤン（ティン）：Sa の共鳴。調和した倍音（1:2:3）と、縁の当たり */
    osc(f, 0, 0, 0, 0.70, 0.40); osc(f * 2, 0, 0, 0, 0.36, 0.20); osc(f * 3.003, 0, 0, 0, 0.24, 0.11);
    if (rich) osc(f * 2.99, 0, 0, 0, 0.30, 0.05);                                           /* わずかなうなり */
    this.play1(b.drum.ghost, when, 1.9, 0.08 * v, out, 7000, 0.02, 2500);
  } else if (p === 62) {                                /* ダヤンの縁（ナ・タ）：硬い当たりと短い輪 */
    osc(f * 2.01, 0, 0, 0, 0.20, 0.30); osc(f * 3.1, 0, 0, 0, 0.12, 0.14);
    if (rich) osc(f * 4.2, 0, 0, 0, 0.07, 0.06);
    this.play1(b.drum.ghost, when, 2.4, 0.17 * v, out, 9000, 0.03, 3500);
  } else {                                              /* 鋭い音（カ・ケ）：バヤンを手のひらで押さえた短い破裂 */
    this.play1(b.drum.ghost, when, p === 60 ? 2.6 : 1.9, 0.26 * v, out, p === 60 ? 8000 : 5200, 0.05, 1500);
    osc(fb * 1.6, 0, 0, fb * 1.2, 0.07, 0.16);
    if (rich) this.play1(b.drum.ghost, when + 0.002, 1.2, 0.07 * v, out, 1800, 0.02, 700);
  }
};
Engine.prototype.ghatamHit = function (p, when, v, out) {
  var ctx = this.ctx, b = this.bank, fr = p === 76 ? 420 : (p === 77 ? 560 : 900);
  var o = ctx.createOscillator(); o.type = "sine";
  o.frequency.setValueAtTime(fr * 1.15, when); o.frequency.exponentialRampToValueAtTime(fr, when + 0.04);
  var g = ctx.createGain(); g.gain.setValueAtTime(0.5 * v, when); g.gain.exponentialRampToValueAtTime(0.0008, when + (p === 68 ? 0.07 : 0.2));
  o.connect(g); g.connect(out); o.start(when); o.stop(when + 0.24);
  this.play1(b.drum.ghost, when, 2.0, 0.12 * v, out, 6500, 0.03, 1800);
};
/* フラメンコギター：胴鳴り（空気共鳴・表板・箱鳴りの谷・張り・糸の鳴り）と軽い飽和。パートごとに1本を共有する */
Engine.prototype.flamBus = function (kind, out) {
  this._fb = this._fb || {};
  if (this._fb[kind]) return this._fb[kind];
  var ctx = this.ctx, ws = ctx.createWaveShaper(), n = 1024, c = new Float32Array(n), i, x;
  for (i = 0; i < n; i++) { x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(1.5 * x) / Math.tanh(1.5); }
  ws.curve = c; ws.oversample = "2x";
  function pk(f, q, g, type) { var b = ctx.createBiquadFilter(); b.type = type || "peaking"; b.frequency.value = f; b.Q.value = q; b.gain.value = g; return b; }
  var f1 = pk(105, 1.3, 3.2), f2 = pk(215, 1.1, 2.4), f5 = pk(380, 1.0, -2.2), f3 = pk(2600, 0.9, 3.0), f4 = pk(5800, 0.7, 3.0, "highshelf");
  var g = ctx.createGain(); g.gain.value = 0.9;
  ws.connect(f1); f1.connect(f2); f2.connect(f5); f5.connect(f3); f3.connect(f4); f4.connect(g); g.connect(out);
  try {                                                  /* 初期反射：小さな部屋（タブラオ）の壁。ごく短い2本の遅れ */
    var d1 = ctx.createDelay(0.05), d2 = ctx.createDelay(0.05), rg1 = ctx.createGain(), rg2 = ctx.createGain(), rl = ctx.createBiquadFilter();
    d1.delayTime.value = 0.0113; d2.delayTime.value = 0.0187; rg1.gain.value = 0.10; rg2.gain.value = 0.065;
    rl.type = "lowpass"; rl.frequency.value = 5200;
    g.connect(d1); g.connect(d2); d1.connect(rg1); d2.connect(rg2); rg1.connect(rl); rg2.connect(rl); rl.connect(out);
  } catch (x) {}
  return (this._fb[kind] = ws);
};
/* カホン：箱の鳴り（低い谷と中域の木の響き）。バホ・タパで1本を共有 */
Engine.prototype.cajBus = function (out) {
  if (this._cjb) return this._cjb;
  var ctx = this.ctx, inn = ctx.createGain();
  function pk(f, q, g, type) { var bq = ctx.createBiquadFilter(); bq.type = type || "peaking"; bq.frequency.value = f; bq.Q.value = q; bq.gain.value = g; return bq; }
  var a = pk(92, 1.2, 3.0), b2 = pk(330, 1.1, -2.5), c = pk(2300, 0.9, 2.2), d = pk(120, 0.7, 0, "highpass");
  inn.connect(d); d.connect(a); a.connect(b2); b2.connect(c); c.connect(out);
  try {
    var dl = ctx.createDelay(0.05), dg = ctx.createGain();
    dl.delayTime.value = 0.0127; dg.gain.value = 0.09;
    c.connect(dl); dl.connect(dg); dg.connect(out);
  } catch (x) {}
  return (this._cjb = inn);
};
/* 掛け声（ハレオ）：男声の短い叫び。フォルマント（母音の共鳴）を持つノコギリ波＋息の雑音。
   p＝60 Olé／62 Arsa／64 Eh／66 Ea／68 Vamos／70 Olé tú／72 Toma／74 Ahí／76 Así／78 Dale／80 Ay（嘆きの声） */
Engine.prototype.jaleoHit = function (p, when, dur, vel, out) {
  var ctx = this.ctx, v = Math.max(0.1, Math.min(1, vel / 110)), b = this.bank, self = this;
  var VOW = { o: [480, 860], e: [430, 2100], a: [760, 1250], i: [300, 2300], u: [320, 800] };
  try {                                                                             /* 叫ぶ人の立ち位置（左右に散らばる） */
    if (ctx.createStereoPanner) { var jpn = ctx.createStereoPanner(); jpn.pan.value = (Math.random() - 0.5) * 1.3; jpn.connect(out); out = jpn; }
  } catch (x) {}
  var spread = 1 + (Math.random() - 0.5) * 0.14, crowd = Math.random() < 0.5 && self.loadLevel(when, 4) < 1 && self.extra(when);     /* 叫ぶ人ごとに声の高さが違う／仲間の声が少し遅れて重なる */
  function syl(t, d, vow, fa, fb, gain, vib, solo) {
    if (!solo && crowd) { syl(t + 0.018 + Math.random() * 0.03, d * 1.05, vow, fa * 0.94, fb * 0.94, gain * 0.5, vib, true); }
    fa *= spread; fb *= spread;
    var o = ctx.createOscillator(); o.type = "sawtooth";
    o.frequency.setValueAtTime(fa * 0.93, t); o.frequency.linearRampToValueAtTime(fa, t + 0.03); o.frequency.linearRampToValueAtTime(fb, t + d);       /* 叫び始めは下から跳ね上がる */
    if (vib) {
      try { var lf = ctx.createOscillator(), lg = ctx.createGain(); lf.frequency.value = 5.4; lg.gain.value = fa * 0.03; lf.connect(lg); lg.connect(o.frequency); lf.start(t + 0.1); lf.stop(t + d + 0.03); } catch (x) {}
    }
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + 0.025); g.gain.setValueAtTime(gain, t + d * 0.65); g.gain.exponentialRampToValueAtTime(0.0008, t + d);
    var f = VOW[vow], i;
    for (i = 0; i < 3; i++) {
      var bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = i < 2 ? f[i] : 2650; bp.Q.value = i === 0 ? 6 : (i === 1 ? 9 : 10);
      var gg = ctx.createGain(); gg.gain.value = i === 0 ? 1.0 : (i === 1 ? 0.6 : 0.3);
      o.connect(bp); bp.connect(gg); gg.connect(g);
    }
    var am = ctx.createGain(); am.gain.value = 1;                                     /* しわがれ（声帯の不規則な揺れ。重ねた声には付けない） */
    if (!solo) try {
      var amo = ctx.createOscillator(), amg = ctx.createGain(); amo.frequency.value = 70 + Math.random() * 40; amg.gain.value = 0.10 + 0.14 * v;
      amo.connect(amg); amg.connect(am.gain); amo.start(t); amo.stop(t + d + 0.03);
    } catch (x) {}
    g.connect(am); am.connect(out); o.start(t); o.stop(t + d + 0.03);
    if (d > 0.1 && !solo) self.play1(b.drum.ghost, t, 1.6, 0.05 * v, out, f[1], d * 0.8, 600);       /* 息（声に混ざる息の雑音） */
  }
  function hiss(t, d, gn) { self.play1(b.drum.ghost, t, 3.0, gn * v, out, 9000, d, 4500); }       /* s・t・d などの子音 */
  var f0 = 118 + (Math.random() - 0.5) * 8, gn = 0.55 * v;
  if (p === 62) {                         /* ¡Arsa! */
    syl(when, 0.16, "a", f0 * 1.1, f0 * 1.05, gn); hiss(when + 0.16, 0.07, 0.2); syl(when + 0.22, 0.22, "a", f0 * 1.05, f0 * 0.85, gn * 0.9);
  } else if (p === 64) {                  /* ¡Eh! */
    syl(when, 0.22, "e", f0 * 1.2, f0 * 0.9, gn);
  } else if (p === 66) {                  /* ¡Ea! */
    syl(when, 0.14, "e", f0 * 1.15, f0 * 1.15, gn * 0.9); syl(when + 0.14, 0.24, "a", f0 * 1.1, f0 * 0.85, gn);
  } else if (p === 68) {                  /* ¡Vamos! */
    hiss(when, 0.03, 0.1); syl(when + 0.02, 0.13, "a", f0 * 1.05, f0 * 1.1, gn); syl(when + 0.16, 0.16, "o", f0 * 1.1, f0 * 0.95, gn * 0.95); hiss(when + 0.31, 0.08, 0.16);
  } else if (p === 70) {                  /* ¡Olé tú! */
    syl(when, 0.16, "o", f0, f0 * 1.05, gn); syl(when + 0.15, 0.2, "e", f0 * 1.18, f0 * 1.0, gn * 1.05); hiss(when + 0.38, 0.03, 0.12); syl(when + 0.4, 0.3, "u", f0 * 1.1, f0 * 0.85, gn);
  } else if (p === 72) {                  /* ¡Toma! */
    hiss(when, 0.03, 0.18); syl(when + 0.02, 0.12, "o", f0 * 1.1, f0 * 1.1, gn * 1.05); syl(when + 0.15, 0.22, "a", f0 * 1.05, f0 * 0.82, gn);
  } else if (p === 74) {                  /* ¡Ahí! */
    syl(when, 0.12, "a", f0 * 1.1, f0 * 1.15, gn); syl(when + 0.11, 0.24, "i", f0 * 1.4, f0 * 1.2, gn * 0.95);
  } else if (p === 76) {                  /* ¡Así! */
    syl(when, 0.12, "a", f0 * 1.1, f0 * 1.1, gn); hiss(when + 0.12, 0.07, 0.16); syl(when + 0.2, 0.22, "i", f0 * 1.35, f0 * 1.15, gn * 0.95);
  } else if (p === 78) {                  /* ¡Dale! */
    hiss(when, 0.025, 0.14); syl(when + 0.02, 0.12, "a", f0 * 1.1, f0 * 1.1, gn); syl(when + 0.15, 0.22, "e", f0 * 1.2, f0 * 0.95, gn);
  } else if (p === 80) {                  /* ¡Ay!（嘆き：長く、揺れながら下がる） */
    var dd = Math.max(0.55, Math.min(1.1, dur * 0.8));
    syl(when, dd * 0.55, "a", f0 * 1.6, f0 * 1.45, gn * 0.9, true); syl(when + dd * 0.5, dd * 0.55, "i", f0 * 1.45, f0 * 1.0, gn * 0.8, true);
  } else {                                /* ¡Olé! */
    syl(when, 0.18, "o", f0, f0 * 1.05, gn); syl(when + 0.17, Math.min(0.4, Math.max(0.25, dur * 0.6)), "e", f0 * 1.18, f0 * 0.95, gn * 1.05);
  }
};
/* 歌（カンテ）：しわがれた男声。2本のノコギリ波（少しずれ）＋母音の共鳴（フォルマント）＋遅れて入るビブラート＋息の雑音。g＝ポルタメント、vw＝母音 */
Engine.prototype.canteVoice = function (p, when, dur, vel, out, g, gd, ao, vw, fl) {
  var ctx = this.ctx, v = Math.max(0.1, Math.min(1, vel / 110)), b = this.bank;
  var VOW = [[760, 1250], [430, 2100], [300, 2300], [480, 860], [320, 800]], F0 = VOW[vw || 0] || VOW[0];
  var open = 1 + Math.max(-0.12, Math.min(0.22, (p - 62) * 0.012));                 /* 高い音ほど口が開いて第1フォルマントが上がる */
  var F = [F0[0] * open, F0[1] * (1 + (open - 1) * 0.3)];
  var f = 440 * Math.pow(2, (p - 69) / 12), len = Math.max(0.12, dur), t = when, i;
  var o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
  o1.type = "sawtooth"; o2.type = "sawtooth";
  o1.frequency.value = f; o2.frequency.value = f * 1.0035;
  if (g) {
    var f0 = f * Math.pow(2, g / 12), gg = Math.max(0.05, gd || 0.15);
    o1.frequency.setValueAtTime(f0, t); o1.frequency.exponentialRampToValueAtTime(f, t + gg);
    o2.frequency.setValueAtTime(f0 * 1.0035, t); o2.frequency.exponentialRampToValueAtTime(f * 1.0035, t + gg);
  }
  if (fl && len > 0.35) {                                 /* 音の終わりで半音ほど落ちる（歌の落ち：カイーダ） */
    var fe = f * Math.pow(2, -Math.min(2, fl) / 12), ft = t + len - Math.min(0.2, len * 0.3);
    o1.frequency.setValueAtTime(f, ft); o1.frequency.linearRampToValueAtTime(fe, t + len);
    o2.frequency.setValueAtTime(f * 1.0035, ft); o2.frequency.linearRampToValueAtTime(fe * 1.0035, t + len);
  }
  var vibOn = (ao || len > 0.9) && len > 0.45;
  if (vibOn) {
    try {
      var lfo = ctx.createOscillator(), lg = ctx.createGain();
      lfo.frequency.value = 5.2 + Math.random() * 0.6;
      lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(f * 0.012, t + Math.min(0.6, len * 0.7));     /* 遅れて深くなる */
      lfo.connect(lg); lg.connect(o1.frequency); lg.connect(o2.frequency);
      lfo.start(t); lfo.stop(t + len + 0.1);
      var lf2 = ctx.createOscillator(), lg2 = ctx.createGain();                       /* 深さ・速さのゆらぎ（機械的に一定にしない） */
      lf2.frequency.value = 0.6 + Math.random() * 0.8; lg2.gain.value = f * 0.004;
      lf2.connect(lg2); lg2.connect(lg.gain); lf2.start(t); lf2.stop(t + len + 0.1);
      var lg3 = ctx.createGain(); lg3.gain.value = 0.35;
      lf2.connect(lg3); lg3.connect(lfo.frequency);
    } catch (x) {}
  }
  var env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t); env.gain.linearRampToValueAtTime(0.5 * v, t + 0.035);
  env.gain.setValueAtTime(0.5 * v, t + Math.max(0.05, len * 0.8)); env.gain.exponentialRampToValueAtTime(0.0008, t + len + 0.06);
  var mix = ctx.createGain(); mix.gain.value = 0.5; o1.connect(mix); o2.connect(mix);
  if (len > 0.5) try {                                                                /* 音程の細かなゆらぎ（人の声は一定の高さではない。長い音だけ） */
    var jt = ctx.createOscillator(), jg = ctx.createGain();
    jt.frequency.value = 7 + Math.random() * 5; jg.gain.value = f * 0.0025;
    jt.connect(jg); jg.connect(o1.frequency); jg.connect(o2.frequency); jt.start(t); jt.stop(t + len + 0.1);
  } catch (x) {}
  if (v > 0.6 && len > 0.35 && this.extra(when)) {                                    /* 強く張ると声帯が不規則に鳴る（1オクターヴ下のざらつき） */
    var o3 = ctx.createOscillator(), g3 = ctx.createGain();
    o3.type = "sawtooth"; o3.frequency.value = f * 0.5 * 1.002; g3.gain.value = 0.16 * (v - 0.4);
    o3.connect(g3); g3.connect(mix); o3.start(t); o3.stop(t + len + 0.1);
  }
  for (i = 0; i < 3; i++) {
    var bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = i === 0 ? 5 : (i === 1 ? 8 : 9);
    var fi = i < 2 ? F[i] : 2750 + v * 300;                                          /* 第3フォルマント：張った声の「鳴り」 */
    bp.frequency.setValueAtTime(fi * 0.86, t); bp.frequency.linearRampToValueAtTime(fi, t + 0.07);        /* 前の母音から移る */
    var gx = ctx.createGain(); gx.gain.value = i === 0 ? 1.0 : (i === 1 ? 0.55 : 0.18 + 0.2 * v);
    mix.connect(bp); bp.connect(gx); gx.connect(env);
  }
  /* しわがれ：強く歌うほど、声帯の不規則な振幅の揺れ（約60〜90Hz）を深くする */
  var am = ctx.createGain(); am.gain.value = 1;
  try {
    var amo = ctx.createOscillator(), amg = ctx.createGain();
    amo.frequency.value = 62 + Math.random() * 28; amg.gain.value = 0.05 + 0.16 * v;
    amo.connect(amg); amg.connect(am.gain); amo.start(t); amo.stop(t + len + 0.1);
  } catch (x) {}
  env.connect(am); am.connect(out);
  o1.start(t); o2.start(t); o1.stop(t + len + 0.1); o2.stop(t + len + 0.1);
  if (this.loadLevel(when, 4) < 2) {
    this.play1(b.drum.ghost, t, 2.2, 0.05 * v, out, 5200, Math.min(0.25, len), 1800);                                   /* 息・しわがれ */
    if (len > 0.5) this.play1(b.drum.ghost, t, 1.4, 0.07 * v, out, 3800, 0.07, 900);                                   /* 出だしの息（h） */
    if (len > 0.3 && Math.random() < 0.3) this.play1(b.drum.ghost, t - 0.004, 0.9, 0.06 * v, out, 1300, 0.02, 500);    /* 声門の破裂（母音の頭の「ッ」） */
    if (len > 0.7) this.play1(b.drum.ghost, t + len * 0.7, 1.2, 0.04 * v, out, 3200, Math.min(0.2, len * 0.3), 1200);  /* 語尾の息抜け */
  }
};
Engine.prototype.voice = function (kind, p, when, dur, vel, g, gd, ao, vw, fl, ar) {
  /* 音切れ対策：ごく短い時間に発音が集中したら、弱い打楽器から間引く */
  var slot = Math.floor(when * 20);
  if (this._loadSlot !== slot) { this._loadSlot = slot; this._loadN = 0; }
  this._loadN = (this._loadN || 0) + 1;
  this.curKind = kind;
  var kindOut = kind;                                              /* ギタートリオのラスゲアード（gtrg）は、伴奏と同じ軽い鳴らし方（ただし音色・定位はギター2） */
  if (kind === "gtrg") kind = "comp";
  this.busy = (this._loadN > 5) ? 2 : (this._loadN > 3 ? 1 : 0);   /* 同じ瞬間に何音鳴るか */
  var lv0 = this.loadLevel(when, 0);
  if (lv0 >= 1 && (kind === "perc" || kind === "perc2" || kind === "perc3") && vel < 72) return;          /* 混んだら弱い打楽器から落とす */
  if (lv0 >= 2 && (kind === "perc" || kind === "perc2" || kind === "perc3" || kind === "drums") && vel < 84) return;
  if (this._loadN > 6 && kind === "comp" && vel < 78) return;   /* 混んだら伴奏の弱い声部を落とす */
  if ((this.thin || this._noExtra) && (kind === "perc" || kind === "perc2" || kind === "perc3") && vel < (this.thin ? 70 : 60)) return;          /* 軽量モード（や遅れが続いたとき）は弱い手拍子を間引く */
  if (this._loadN > 7) {
    if ((kind === "perc" || kind === "perc2" || kind === "perc3" || kind === "drums") && vel < 76) return;
    if (this._loadN > 11 && vel < 64) return;
    if (this._loadN > 15 && kind === "comp" && vel < 74) return;
  }
  if (this.sfUse() && this.sfPlay(kindOut, p, when, dur, vel, this.sfOutFor(kindOut))) return;
  if (kind === "comp" && this.keyType) {
    var g0 = this.gains.comp;
    if (g0) this.keyNote(p, when, dur, Math.max(0.15, Math.min(1, vel / 110)), this.keyType, g0);
    return;
  }
  var ctx = this.ctx, out = this.gains[kindOut] || this.gains[kind] || this.master, b = this.bank;
  var v = Math.max(0.03, Math.min(1, vel / 127));
  var TTc = this.tone || TONE.swing;
  if (TTc.chip) { this.chipVoice(kind, p, when, dur, vel, this.gains[kind] || this.gains.mel); return; }
  if (kind === "drums" || kind === "perc" || kind === "perc2" || kind === "perc3") { this.drum(p, when, v); return; }
  if (kind === "jaleo") { this.jaleoHit(p, when, dur, vel, out); return; }
  if (kind === "wfl") { this.orchVoice("fl", p, when, dur, vel, out, "flute"); return; }                 /* セクステットのフルート */
  if (kind === "wsx") { this.blownVoice(p, when, dur, vel, out); return; }                              /* ソプラノ・サックス */
  if (kind === "gtr2") kind = "mel";                                                                    /* 2本目のギターは旋律と同じ鳴らし方（バスは別） */
  if (kind === "cante") { this.canteVoice(p, when, dur, vel, out, g, gd, ao, vw, fl); return; }
  var TT = TTc;
  if (TT.ind) {
    var indM = (this.song && this.song.indian) ? this.song.indian.mode : "";
    if (kind === "harp" || (kind === "mel" && indM !== "shakti")) { this.sitarVoice(kind, p, when, dur, vel, out, g, gd, ao); return; }
  }
  if (TT.orch) {
    var sInst = this.song && this.song.opt ? this.song.opt.epicSolo : null;
    var so = (this.song && this.song.opt) || {};
    if (kind === "solo") {
      if (sInst === "piano") { this.keysVoice(p, when, dur, vel, out, "piano"); return; }
      if (sInst !== "guitar") {
        this.orchVoice(kind, p, when, dur, vel, out, sInst === "flute" ? "flute" : sInst === "violin" ? "strings" : sInst === "trumpet" ? "brass" : "reed");
        return;
      }
    }
    if (kind === "comp" && so.orchComp === "organ") { this.keyNote(p, when, dur, Math.max(0.05, Math.min(1, vel / 127)) * 0.8, "organ", out); return; }
    if (kind === "horn" && so.scene === "boss") { this.orchVoice(kind, p, when, dur, vel, out, "choir"); return; }
    if (kind === "comp" && so.orchComp === "town") { this.orchVoice(kind, p, when, dur, vel, out, "pizz"); return; }
    if (kind === "comp" && so.orchComp === "ostlow") { this.orchVoice(kind, p, when, dur, vel, out, "strShort"); return; }
    if (kind === "bass" && so.orchBass === "pizz2") { this.orchVoice(kind, p, when, dur, vel, out, "pizz"); return; }
    if (kind === "comp" && so.orchComp === "hpsi") { this.orchVoice(kind, p, when, dur, vel, out, "hpsi"); return; }
    if (kind === "comp" && so.orchComp === "ostinato") { this.orchVoice(kind, p, when, dur, vel, out, "strShort"); return; }
    if (kind === "bass" && so.orchBass === "pizz") { this.orchVoice(kind, p, when, dur, vel, out, "pizz"); return; }
    if (kind === "bass" && so.orchBass === "tuba") { this.orchVoice(kind, p, when, dur, vel, out, "horn"); return; }
    if (kind === "horn" && so.scene === "battle") { this.orchVoice(kind, p, when, dur, vel, out, "brass"); return; }
    var WBK = { fl: "flute", ob: "reed", cl: "clar", bsn: "reed", tpt: "brass", trb: "brass", tuba: "horn" };
    if (WBK[kind]) { this.orchVoice(kind, p, when, dur, vel, out, WBK[kind]); return; }
    if ((kind === "bass" && so.orchBass === "elec") || (kind === "comp" && so.orchComp === "guitar")) { /* エレキベース・西部劇のギターは通常の音で */ }
    else
    if (kind === "mel" || kind === "comp" || kind === "bass" || kind === "horn" || kind === "harp" || kind === "timp" || kind === "cello") {
      this.orchVoice(kind, p, when, dur, vel, out); return;
    }
  }
  if (TT.ind && kind === "solo") { this.orchVoice(kind, p, when, dur, vel, out, "strings"); return; }
  if ((kind === "mel" || kind === "solo") && TT.lead === "blown") { this.blownVoice(p, when, dur, vel, out); return; }
  if ((kind === "mel" || kind === "solo") && TT.lead === "keys") { this.keysVoice(p, when, dur, vel, out, TT.keysKind); return; }
  if (kind === "pno") { this.keysVoice(p, when, dur, vel, out, "piano"); return; }
  if (kind === "comp" && TT.comp === "keys") { this.keysVoice(p, when, dur, vel, out, TT.keysKind || "piano"); return; }
  if (kind === "comp" && TT.comp === "synth") { this.synthSaw(p, when, dur, v, out); return; }
  if (kind === "comp" && TT.comp === "organ") { this.keysVoice(p, when, dur, vel, out, "organ"); return; }

  if (kind === "bass" && TT.bassOrgan) { this.keysVoice(p, when, Math.max(0.12, dur), vel, out, "organ"); return; }
  if (kind === "bass") {
    var bi = pickNear(b.bassPitch, p);
    var rate = Math.pow(2, (p - b.bassPitch[bi]) / 12) * (1 + (Math.random() - 0.5) * 0.002);
    var bsrc = this.play1(b.bass[bi], when, rate, 0.42 * v + 0.08, out, 540 + 620 * v, Math.max(0.14, dur));
    /* 指が当たる音 */
    this.play1(b.drum.ghost, when, 1, 0.035 * v, out, 1800, 0.05);
    if (this.real !== false) {
      /* 弦を弾いた瞬間に音程がわずかに高く、すぐに落ち着く／指板に当たる低い音／強く弾くほど明るく */
      try { bsrc.playbackRate.setValueAtTime(rate * (1 + 0.010 + 0.012 * v), when); bsrc.playbackRate.exponentialRampToValueAtTime(rate, when + 0.035); } catch (x) {}
      if (!this.thin && v > 0.5 && this.loadLevel(when, 3) < 1) this.play1(b.drum.ghost, when, 0.7, 0.045 * v, out, 700, 0.03);
    }
    return;
  }
  var T = this.tone || TONE.swing;
  if (this.song && this.song.guitarTrio && TONE["gt_" + kindOut]) T = TONE["gt_" + kindOut];            /* ギタートリオ：パートごとに音色を変える */
  var inst = (kind === "comp") ? (this.instComp || "pluck") : (this.leadOverride || this.instLead || "pluck");
  if (kind === "horn" && this.song && this.song.opt && this.song.opt.orgTrade) inst = "organ";        /* オルガン・トリオ（掛け合い）：オルガンのソロ（horn）。テーマ・ギターのソロはギター */
  /* 伸ばした音の芯にトーンホイールを薄く重ねる（バラードの伸ばしに効く。スウィングでも少し） */
  var TT0 = this.tone || TONE.swing;
  if (TT0.pad && kind !== "comp" && dur > 0.7 && this.tonewheel && inst !== "organ" && this.loadLevel(when, 0) < 1) {
    this.tonewheel(p, when + 0.015, dur * 0.96, Math.min(118, vel), out, TT0.pad, false);
  }
  if (inst === "rhodes") { this.synthRhodes(p, when, dur, v, out); return; }
  if (inst === "piano") { this.synthPiano(p, when, dur, v, out); return; }
  if (inst === "horn") { this.synthHorn(p, when, dur, v, out); return; }
  if (inst === "organ") { this.synthOrgan(p, when, dur, v, out); return; }
  var gb = this.gtrBank(T.bank);
  var gi = pickNear(gb.pitch, p);
  var r = Math.pow(2, (p - gb.pitch[gi]) / 12) * (1 + (Math.random() - 0.5) * (kind === "comp" ? 0.0030 : 0.0012));
  var open = T.lp[0] + (T.lp[1] - T.lp[0]) * v * v;
  if (T.flam) open *= 0.88 + Math.random() * 0.24;                  /* 指（爪）の当たり方で、音色が毎回少し変わる */
  var len = Math.max(kind === "comp" ? 0.05 : 0.12, dur) * (kind === "comp" ? 1 : T.rel);
  var lvl = T.lvl == null ? 1 : T.lvl;
  var gain = ((kind === "comp" ? 0.30 : 0.42) * v + (kind === "comp" ? 0.03 : 0.05)) * lvl;
  var outTo = out;
  var drv = (kind === "comp") ? T.driveComp : T.drive;
  if (drv) {
    /* 歪み：パートごとに1本の回路を共有（1音ごとに作らない＝軽い） */
    this.driveBus = this.driveBus || {};
    var bk = kind + ":" + drv;
    if (!this.driveBus[bk]) {
      var ws = ctx.createWaveShaper();
      this._dcs = this._dcs || {};
      ws.curve = this._dcs[drv] || (this._dcs[drv] = driveCurve(ctx, drv));
      var post = ctx.createBiquadFilter(); post.type = "lowpass"; post.frequency.value = (kind === "comp") ? 3000 : 3600;
      var mid = ctx.createBiquadFilter(); mid.type = "peaking"; mid.frequency.value = 800; mid.Q.value = 0.9;
      mid.gain.value = (kind === "comp") ? -6 : -2;                  /* 中域をえぐる（メタルの音） */
      var pg = ctx.createGain(); pg.gain.value = (kind === "comp") ? 0.24 : 0.20;
      ws.connect(post); post.connect(mid); mid.connect(pg); pg.connect(out);
      this.driveBus[bk] = ws;
    }
    outTo = this.driveBus[bk];
  } else if (T.flam && (kind === "mel" || kind === "solo" || kind === "comp")) {
    outTo = this.flamBus(kind, out);
  }
  var src0 = (gb.buf2.length && Math.random() < 0.5) ? gb.buf2[gi] : gb.buf[gi];
  var lead = this.play1(src0, when, r, gain, outTo, (kind === "comp" && LV >= 1) ? -1 : (kind === "comp" ? open * 0.85 : open), len);
  var LV = this.loadLevel(when, 4);
  if (T.flam && LV < 2 && ar === 1) this.play1(b.drum.ghost, when, 2.4 + Math.random() * 0.6, 0.10 * v, outTo, 6500, 0.05, 2500);        /* ラスゲアード：爪が弦をなでる音 */
  if (T.flam && LV < 2 && ar === 2) { this.play1(b.drum.ghost, when + 0.005, 0.8, 0.07 * v, outTo, 800, 0.06); }                               /* アパガード：手のひらで止めた低い当たり */
  if (T.flam && LV < 2) {
    /* 低い弦はフレットに触れて少しビビる／強い音は爪が弦を打つ音／ラスゲアードは爪の擦れる音 */
    if (p < 52 && v > 0.55) this.play1(b.drum.ghost, when, 0.9 + Math.random() * 0.2, 0.05 * v, outTo, 1400, 0.09);
    if (v > 0.7 && kind !== "comp") this.play1(b.drum.ghost, when, 2.6, 0.09 * v, outTo, 7000, 0.025, 3000);
    if (kind === "comp" && LV < 1 && Math.random() < 0.5) this.play1(b.drum.ghost, when, 3.0, 0.07 * v, outTo, 8000, 0.02, 3500);
    if (LV < 1) {
      /* 爪で弾いた瞬間：音程がわずかに高く、すぐ落ち着く（弦を引っ張る） */
      try { lead.playbackRate.setValueAtTime(r * (1 + 0.004 + 0.006 * v), when); lead.playbackRate.exponentialRampToValueAtTime(r, when + 0.03); } catch (x) {}
      /* ほかの弦が共鳴して鳴る（開放弦のオクターブ）／表板が鳴る低い当たり */
      if (kind !== "comp") { if (this.extra(when)) this.play1(src0, when + 0.012, r * 2, gain * 0.07, out, 4200, len * 0.6); }
      else if (v > 0.5 && Math.random() < 0.35 && this.extra(when)) this.play1(src0, when + 0.014, r * 2, gain * 0.045, out, 3800, len * 0.5);
      if (kind !== "comp" && dur < 0.35 && Math.random() < 0.35) this.play1(b.drum.ghost, when + len, 0.8, 0.045 * v, out, 1500, 0.04, 500);   /* 短い音は指で止める（弦に触れる低い音） */
      if (v > 0.7 && kind !== "comp" && this.extra(when)) {
        var bo = ctx.createOscillator(); bo.type = "sine"; bo.frequency.setValueAtTime(112 + Math.random() * 14, when); bo.frequency.exponentialRampToValueAtTime(92, when + 0.07);
        var bgn = ctx.createGain(); bgn.gain.setValueAtTime(0.05 * v, when); bgn.gain.exponentialRampToValueAtTime(0.0008, when + 0.09);
        bo.connect(bgn); bgn.connect(out); bo.start(when); bo.stop(when + 0.11);
      }
    }
  }
  /* 鼻にかかる帯域（ジプシーのセルマー／フラメンコの乾いた張り） */
  if (T.nasal && LV < 2 && kind !== "comp") {
    var nz = ctx.createBufferSource(); nz.buffer = src0; nz.playbackRate.value = r;
    var bp = ctx.createBiquadFilter(); bp.type = "bandpass";
    bp.frequency.value = T.nasal; bp.Q.value = 1.6;
    var ng = ctx.createGain(); ng.gain.setValueAtTime(gain * 0.5, when);
    ng.gain.setValueAtTime(gain * 0.5, when + Math.max(0.02, len - 0.03));
    ng.gain.exponentialRampToValueAtTime(0.0008, when + len + 0.05);
    nz.connect(bp); bp.connect(ng); ng.connect(out);
    nz.start(when); nz.stop(when + len + 0.12);
  }
  /* 弦に爪・ピックが当たる音 */
  if (T.pick > 0.001 && kind !== "comp" && (LV < 1 || v > 0.6)) this.play1(b.drum.ghost, when, 1.8 + Math.random() * 0.4, T.pick * v, out, 9000, 0.03, 2200);
  /* 厚み（クリーンな電気ギターの揺れ） */
  if (T.det > 0 && kind !== "comp" && LV < 1) {
    this.play1(src0, when + 0.004, r * (1 + T.det / 1200), gain * 0.55, out, open * 0.9, len);
  }
  /* 指が弦から離れる音（長い音の終わりに） */
  if (len > 0.7 && kind !== "comp" && LV < 1 && Math.random() < 0.18) {
    this.play1(b.drum.ghost, when + len * 0.95, 2.2, 0.04 * v, out, 6000, 0.05, 1800);
  }
  /* 長い音のビブラート */
  if (dur > 0.9 && kind !== "comp" && T.vib !== 0 && LV < 1) {
    try {
      var lfo = ctx.createOscillator(), lg = ctx.createGain();
      lfo.frequency.value = 5.1 + Math.random() * 0.8;
      lg.gain.value = r * 0.004;
      lfo.connect(lg); lg.connect(lead.playbackRate);
      lfo.start(when + 0.18); lfo.stop(when + len + 0.1);
    } catch (e) {}
  }
};

/* リアル寄りのドラム。胴の鳴り・打面の当たり・響き線・金属の倍音を重ね、毎回わずかに変える（同じ音の連打にならない）。
   音量は従来の音に合わせてある。扱わない番号は従来の音（false を返す）。 */
Engine.prototype.drumReal = function (p, when, v) {
  var b = this.bank, out = this.gains.drums || this.master, ctx = this.ctx, self = this;
  var rr = 1 + (Math.random() - 0.5) * 0.12, v2 = v * rr;
  var LVD = this.loadLevel ? this.loadLevel(when, 3) : 0, rich = (LVD < 1 && !this.thin);   /* 追加の層（細部）を鳴らしてよいか */
  function sine(f0, f1, tp, g, dec) {
    var o = ctx.createOscillator(); o.type = "sine";
    o.frequency.setValueAtTime(f0, when); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, when + tp);
    var gg = ctx.createGain(); gg.gain.setValueAtTime(g, when); gg.gain.exponentialRampToValueAtTime(0.0008, when + dec);
    o.connect(gg); gg.connect(out); o.start(when); o.stop(when + dec + 0.02);
  }
  if (p === 36) {                                   /* バスドラム：胴の鳴り（2つの共鳴）＋打面のクリック */
    var kj = 1 + (Math.random() - 0.5) * 0.04;
    sine(150 * kj, 52 * kj, 0.05, 0.62 * v2, 0.26);
    sine(62 * kj, 56 * kj, 0.2, 0.31 * v2, 0.36);
    if (rich && v > 0.5) self.play1(b.drum.ghost, when, 1.8, 0.07 * v2 * (0.4 + v), out, 5000, 0.02, 1800);
    return true;
  }
  if (p === 38) {                                   /* スネア：響き線（2層）＋胴の音＋スティックの当たり */
    self.play1(b.drum.snare, when, 1.0 + (Math.random() - 0.5) * 0.06, 0.24 * v2, out, 9000, 0, 2200);
    if (rich && v > 0.55) self.play1(b.drum.snare, when, 0.7, 0.10 * v2, out, 7000, 0, 3500);
    sine(185, 165, 0.05, 0.15 * v2, 0.09);
    if (rich && v > 0.7) { sine(330, 300, 0.04, 0.07 * v2, 0.05); self.play1(b.drum.ghost, when, 2.2, 0.06 * v2, out, 8000, 0.02, 2500); }
    return true;
  }
  if (p === 40) {                                   /* ゴースト：弱く、胴を鳴らさない */
    self.play1(b.drum.snare, when, 1.1 + (Math.random() - 0.5) * 0.08, 0.09 * v2, out, 6500, 0, 2500);
    return true;
  }
  if (p === 42) {                                   /* クローズ・ハイハット：金属の倍音＋ノイズ。強いほど長く明るい */
    self.play1(b.drum.hhM, when, 1 + (Math.random() - 0.5) * 0.06, 0.52 * v2 * (0.7 + 0.5 * v), out, 14000, 0, 5500);
    if (rich && v > 0.5) self.play1(b.drum.hh, when, 1 + Math.random() * 0.1, 0.12 * v2, out, 12000, 0, 6000);
    return true;
  }
  if (p === 44) {                                   /* ペダル・ハイハット：ちぇっという足の音 */
    self.play1(b.drum.hhM, when, 0.92, 0.46 * v2, out, 9000, 0, 4000);
    if (rich) self.play1(b.drum.ghost, when, 0.6, 0.07 * v2, out, 900, 0.03);
    return true;
  }
  if (p === 46) { self.play1(b.drum.hhOM, when, 1 + (Math.random() - 0.5) * 0.04, 0.95 * v2, out, 13000, 0, 4500); return true; }
  if (p === 51) {                                   /* ライド：スティックの当たり（ピン）＋ベルの倍音＋うなり */
    var rj = 1 + (Math.random() - 0.5) * 0.03;
    self.play1(b.drum.ride, when, rj, 0.17 * v2, out, 11000);
    if (rich && v > 0.6) { self.play1(b.drum.ping, when, 1, 0.09 * v2, out, 11000); self.play1(b.drum.ride, when, rj * 0.97, 0.05 * v2, out, 9000); }
    return true;
  }
  if (p === 41 || p === 43 || p === 45 || p === 47 || p === 48 || p === 50) {   /* タム：スティックの当たりを足す */
    var bufT = (p === 48 || p === 50) ? b.drum.tomH : (p === 47 || p === 45 ? b.drum.tomM : (p === 41 ? b.drum.surdo : b.drum.tomL));
    self.play1(bufT, when, 1 + (Math.random() - 0.5) * 0.04, 0.44 * v2, out, 5000, 0);
    if (rich) self.play1(b.drum.ping, when, 0.7, 0.05 * v2, out, 7000);
    return true;
  }
  return false;
};
Engine.prototype.drum = function (p, when, v) {
  var b = this.bank, out = this.gains.drums || this.master, ctx = this.ctx;
  if (this.tone && this.tone.ind) {
    if (p >= 60 && p <= 64) { this.tablaHit(p, when, v, out); return; }
    if (p === 76 || p === 77 || p === 68) { this.ghatamHit(p, when, v, out); return; }
  }
  if (this.tone && this.tone.flam) {
    if (p === 77 || p === 76) {                                /* ゴルペ：指で表板を叩く。低い胴鳴り＋軽い当たり */
      var go = ctx.createOscillator(); go.type = "sine";
      go.frequency.setValueAtTime(200, when); go.frequency.exponentialRampToValueAtTime(88, when + 0.06);
      var gg = ctx.createGain(); gg.gain.setValueAtTime(0.55 * v, when); gg.gain.exponentialRampToValueAtTime(0.0008, when + 0.11);
      go.connect(gg); gg.connect(out); go.start(when); go.stop(when + 0.13);
      this.play1(b.drum.ghost, when, 1.3, 0.12 * v, out, 2000, 0.03, 700);
      return;
    }
    if (p === 36 || p === 38) { out = this.cajBus(out); }
    if (p === 36) {                                            /* カホンのバホ（低音）：胴の深い鳴り */
      var cb = ctx.createOscillator(); cb.type = "sine";
      var cv = 1 + (Math.random() - 0.5) * 0.06, cf = 118 + 26 * v;                        /* 強く叩くほど音程が少し上がる＋毎回少し違う */
      cb.frequency.setValueAtTime(cf * cv, when); cb.frequency.exponentialRampToValueAtTime(58 * cv, when + 0.09);
      var cg = ctx.createGain(); cg.gain.setValueAtTime(0.66 * v, when); cg.gain.exponentialRampToValueAtTime(0.0008, when + 0.24);
      cb.connect(cg); cg.connect(out); cb.start(when); cb.stop(when + 0.27);
      if (this.extra(when)) {                                                              /* 背面の穴（ポート）の共鳴：低くゆっくり減衰（余裕があるときだけ） */
        var cp = ctx.createOscillator(); cp.type = "sine";
        cp.frequency.setValueAtTime(86 * cv, when); cp.frequency.exponentialRampToValueAtTime(70 * cv, when + 0.2);
        var cpg = ctx.createGain(); cpg.gain.setValueAtTime(0.0001, when); cpg.gain.linearRampToValueAtTime(0.22 * v, when + 0.012); cpg.gain.exponentialRampToValueAtTime(0.0008, when + 0.3);
        cp.connect(cpg); cpg.connect(out); cp.start(when); cp.stop(when + 0.33);
      }
      this.play1(b.drum.ghost, when, 0.5, 0.15 * v, out, 520 + Math.random() * 120, 0.08);
      if (this.extra(when)) this.play1(b.drum.ghost, when, 1.4, 0.06 * v, out, 1500, 0.015, 600);   /* 板の当たり（手のひら） */
      return;
    }
    if (p === 38) {                                            /* カホンのタパ（スラップ）：板の乾いた当たりと、内側のスナッピーの鳴き */
      var tj = Math.random();
      this.play1(b.drum.snare, when, 1.2 + tj * 0.25, 0.25 * v, out, 8000, 0.0, 1500);
      if (this.extra(when)) this.play1(b.drum.snare, when + 0.004, 0.9, 0.09 * v, out, 5200, 0.0, 2600);          /* スナッピーの鳴き：少し遅れて続く（余裕があるときだけ） */
      var ck = ctx.createOscillator(); ck.type = "sine";
      ck.frequency.setValueAtTime(330 + tj * 90, when); ck.frequency.exponentialRampToValueAtTime(175, when + 0.05);
      var kg = ctx.createGain(); kg.gain.setValueAtTime(0.19 * v, when); kg.gain.exponentialRampToValueAtTime(0.0008, when + 0.06);
      ck.connect(kg); kg.connect(out); ck.start(when); ck.stop(when + 0.08);
      if (this.extra(when)) {
        var cw = ctx.createOscillator(); cw.type = "triangle";                               /* 板の硬い鳴り */
        cw.frequency.setValueAtTime(620 + tj * 140, when); cw.frequency.exponentialRampToValueAtTime(420, when + 0.025);
        var cwg = ctx.createGain(); cwg.gain.setValueAtTime(0.07 * v, when); cwg.gain.exponentialRampToValueAtTime(0.0008, when + 0.035);
        cw.connect(cwg); cwg.connect(out); cw.start(when); cw.stop(when + 0.045);
      }
      if (this.loadLevel(when, 3) < 1 && this.extra(when)) {                                 /* 響き線：板の振動に合わせてビリつく（約170Hz で振幅が揺れる） */
        try {
          var sn = ctx.createBufferSource(); sn.buffer = b.drum.ghost; sn.playbackRate.value = 1.3 + tj * 0.3;
          var shp = ctx.createBiquadFilter(); shp.type = "bandpass"; shp.frequency.value = 3800 + tj * 1200; shp.Q.value = 0.9;
          var sg = ctx.createGain(); sg.gain.setValueAtTime(0.0001, when + 0.004); sg.gain.linearRampToValueAtTime(0.11 * v * (0.5 + v), when + 0.012);
          sg.gain.exponentialRampToValueAtTime(0.0008, when + 0.16);
          var am = ctx.createOscillator(), amg = ctx.createGain(); am.frequency.value = 150 + tj * 40; amg.gain.value = 0.5 * 0.11 * v;
          am.connect(amg); amg.connect(sg.gain);
          sn.connect(shp); shp.connect(sg); sg.connect(out);
          sn.start(when + 0.004); sn.stop(when + 0.18); am.start(when); am.stop(when + 0.18);
        } catch (x) {}
      }
      return;
    }
    if (p === 40) { this.play1(b.drum.ghost, when, 1.7, 0.12 * v, out, 4200, 0.04, 900); return; }   /* 指で軽く叩くゴースト */
    if (p === 85) {                                            /* ピトス：親指と中指の指鳴らし。高い乾いた破裂音＋短い共鳴 */
      this.play1(b.drum.ghost, when, 3.2, 0.2 * v, out, 9500, 0.03, 2600);
      var pt = ctx.createOscillator(); pt.type = "sine";
      pt.frequency.setValueAtTime(1500, when); pt.frequency.exponentialRampToValueAtTime(950, when + 0.02);
      var ptg = ctx.createGain(); ptg.gain.setValueAtTime(0.1 * v, when); ptg.gain.exponentialRampToValueAtTime(0.0008, when + 0.03);
      pt.connect(ptg); ptg.connect(out); pt.start(when); pt.stop(when + 0.05);
      return;
    }
    if (p === 39) {                                            /* パルマス：強い音は鋭い「クララ」、弱い音はこもった「ソルダ」 */
      var rz = Math.random(), rz2 = Math.random();
      if (v > 0.55) {                                          /* クララ：両手が完全には揃わない（2〜9ms のずれ）、打つたびに手の当たりが変わる */
        var sp = 0.003 + rz * 0.007;
        this.play1(b.drum.clap, when, 1.6 + rz2 * 0.5, 0.26 * v, out, 5800 + rz * 1800, 0.04, 1700 + rz2 * 500);
        this.play1(b.drum.clap, when + sp, 2.0 + rz * 0.6, 0.15 * v, out, 7000 + rz2 * 1500, 0.03, 2200);
        if (this.extra(when)) this.play1(b.drum.ghost, when + 0.002, 1.2 + rz2 * 0.4, 0.07 * v, out, 2600 + rz * 900, 0.05, 900);   /* 手のひらの胴鳴り（余裕があるときだけ） */
      } else {                                                 /* ソルダ：手をすぼめて空気を閉じ込める。低くこもった鳴り */
        this.play1(b.drum.clap, when, 0.9 + rz * 0.2, 0.24 * v, out, 2000 + rz2 * 600, 0.07, 450);
        var po = ctx.createOscillator(); po.type = "sine"; po.frequency.setValueAtTime(420 + rz * 120, when); po.frequency.exponentialRampToValueAtTime(260 + rz2 * 60, when + 0.06);
        var pg2 = ctx.createGain(); pg2.gain.setValueAtTime(0.14 * v, when); pg2.gain.exponentialRampToValueAtTime(0.0008, when + 0.09);
        po.connect(pg2); pg2.connect(out); po.start(when); po.stop(when + 0.1);
        if (this.extra(when)) this.play1(b.drum.ghost, when + 0.004, 1.0, 0.06 * v, out, 1400, 0.05, 500);
      }
      return;
    }
  }
  if (this.real !== false && this.drumReal(p, when, v)) return;
  var LVD = this.loadLevel ? this.loadLevel(when, 3) : 0;
  var thin2 = (LVD >= 1 || v < 0.62);      /* 混んでいる／弱い音は芯だけ鳴らす */
  if (p === 36) {                                   /* バスドラム／カホンの低音 */
    var o = ctx.createOscillator(); o.type = "sine";
    o.frequency.setValueAtTime(135, when); o.frequency.exponentialRampToValueAtTime(46, when + 0.09);
    var g = ctx.createGain(); g.gain.setValueAtTime(0.75 * v, when);
    g.gain.exponentialRampToValueAtTime(0.0008, when + 0.22);
    o.connect(g); g.connect(out); o.start(when); o.stop(when + 0.24);
    if (!thin2) this.play1(b.drum.ghost, when, 1.6, 0.10 * v, out, 3000, 0.04);
    return;
  }
  if (p === 38) {                                   /* スネア */
    this.play1(b.drum.snare, when, 1, 0.30 * v, out, 6500, 0, 300);
    var o2 = ctx.createOscillator(); o2.type = "triangle"; o2.frequency.value = 196;
    var g2 = ctx.createGain(); g2.gain.setValueAtTime(0.16 * v, when);
    g2.gain.exponentialRampToValueAtTime(0.0008, when + 0.1);
    o2.connect(g2); g2.connect(out); o2.start(when); o2.stop(when + 0.12);
    return;
  }
  if (p === 40) { this.play1(b.drum.ghost, when, 1.1, 0.16 * v, out, 5200, 0, 400); return; }
  if (p === 37) { this.play1(b.drum.clap, when, 1.5, 0.20 * v, out, 7000, 0, 1200); return; }  /* ゴルペ・リム */
  if (p === 39) {                                   /* 手拍子（パルマス）／ブラシ */
    this.play1(b.drum.clap, when, 1, 0.30 * v, out, 5200, 0, 700);
    this.play1(b.drum.clap, when + 0.008, 1.2, 0.16 * v, out, 6000, 0, 900);
    return;
  }
  if (p === 42 || p === 44) { this.play1(b.drum.hh, when, 1 + Math.random() * 0.1, 0.22 * v, out, 12000, 0, 5000); return; }
  if (p === 46) { this.play1(b.drum.hhO, when, 1, 0.20 * v, out, 11000, 0, 4500); return; }
  if (p === 49) { this.play1(b.drum.crash, when, 1, 0.26 * v, out, 12000); return; }
  if (p === 57) { this.play1(b.drum.crash2, when, 1, 0.24 * v, out, 12000); return; }
  if (p === 51) { this.play1(b.drum.ride, when, 1 + Math.random() * 0.03, 0.20 * v, out, 11000); return; }
  if (p === 59) { this.play1(b.drum.ride2, when, 1, 0.18 * v, out, 11000); return; }
  if (p === 53) { this.play1(b.drum.bell, when, 1, 0.22 * v, out, 11000); return; }
  /* 皮もの（コンガ・ボンゴ・ティンバレス）：胴の音＋アタック */
  function skin(self, f0, decay, noiseAmt, gain, bright) {
    var o = ctx.createOscillator(); o.type = "sine";
    o.frequency.setValueAtTime(f0, when);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.78, when + decay * 0.7);
    var g = ctx.createGain(); g.gain.setValueAtTime(gain * v, when);
    g.gain.exponentialRampToValueAtTime(0.0008, when + decay);
    o.connect(g); g.connect(out); o.start(when); o.stop(when + decay + 0.02);
    if (noiseAmt) self.play1(b.drum.ghost, when, 1.4, noiseAmt * v, out, bright || 4000, 0.05);
  }
  /* 胴もの・木もの・金属ものは作り置きの波形で鳴らす（発振器を作らない＝軽い） */
  if (p === 63) { this.play1(b.drum.congaM, when, 1, 0.42 * v, out, 5200, 0); return; }
  if (p === 62) { this.play1(b.drum.congaH, when, 1.1, 0.30 * v, out, 6000, 0.18); return; }
  if (p === 64) { this.play1(b.drum.congaL, when, 1, 0.46 * v, out, 4200, 0); return; }
  if (p === 60) { this.play1(b.drum.bongoH, when, 1, 0.34 * v, out, 7000, 0); return; }
  if (p === 61) { this.play1(b.drum.bongoL, when, 1, 0.32 * v, out, 6000, 0); return; }
  if (p === 65) { this.play1(b.drum.timbH, when, 1, 0.30 * v, out, 8000, 0); return; }
  if (p === 66) { this.play1(b.drum.timbL, when, 1, 0.34 * v, out, 7000, 0); return; }
  if (p === 56) { this.play1(b.drum.cowbell, when, 1, 0.26 * v, out, 6000, 0); return; }
  if (p === 67) { this.play1(b.drum.agogoH, when, 1, 0.24 * v, out, 7000, 0); return; }
  if (p === 68) { this.play1(b.drum.agogoL, when, 1, 0.24 * v, out, 6500, 0); return; }
  if (p === 75) { this.play1(b.drum.clave, when, 1, 0.40 * v, out, 9000, 0); return; }
  if (p === 76) { this.play1(b.drum.wood, when, 1.15, 0.34 * v, out, 8000, 0); return; }
  if (p === 77) { this.play1(b.drum.wood, when, 0.8, 0.34 * v, out, 6000, 0); return; }
  if (p === 69 || p === 70 || p === 82) { this.play1(b.drum.ghost, when, 1.6, 0.11 * v, out, 12000, 0, 6000); return; }
  if (p === 54) { this.play1(b.drum.hhO, when, 1.3, 0.13 * v, out, 12000, 0, 5000); return; }
  if (p === 73 || p === 74) { this.play1(b.drum.hhO, when, p === 73 ? 1.6 : 0.9, 0.10 * v, out, 9000, 0, 2500); return; }
  if (p === 41 || p === 43 || p === 45 || p === 47 || p === 48 || p === 50) {           /* タム・スルド */
    var bufT = (p === 48 || p === 50) ? b.drum.tomH : (p === 47 || p === 45 ? b.drum.tomM : (p === 41 ? b.drum.surdo : b.drum.tomL));
    this.play1(bufT, when, 1, 0.46 * v, out, 5000, 0);
    return;
  }
  this.play1(b.drum.hh, when, 1, 0.14 * v, out, 10000, 0, 4000);
};

/* 曲→イベント列（秒） */
/* 伴奏の強さの補正（測定：ジャズ系の伴奏がテーマより 12〜18dB 小さかった）。ほかの様式（フラメンコ・エピックなど）は変えない */
var STEM_TRIM = {
  swing: { comp: 1.5 }, gypsy: { comp: 1.45 }, bebop: { comp: 1.5 }, ballad: { comp: 1.45 }, bossa: { comp: 1.15 }, soul: { comp: 0.9 },
  modern: { comp: 1.4 }, odd: { comp: 1.4 }, waltz: { comp: 1.5 }, organjazz: { comp: 0.9 }, fusion: { comp: 1.4 }, brazil: { comp: 1.15 }, latin: { comp: 1.2 },
  classical: { comp: 1.35 }, indian: { perc: 1.5, harp: 1.6 }, wa: { drums: 0.7 },
  mcl_fusion: { comp: 1.4 }, mcl_organ: { comp: 0.9 }, mcl_mahav: { comp: 1.4 }, mcl_organtrio: { comp: 0.9, drums: 0.95 },
  arena: { comp: 1.0 },
  fu_corea: { comp: 1.4 }, fu_weather: { comp: 1.4 }, fu_metheny: { comp: 1.3 }, fu_funk: { comp: 1.4 }, fu_smooth: { comp: 1.4 }, fu_latin: { comp: 1.2 }, fu_prog: { comp: 1.4 },
  guitartrio: { mel: 1.2, gt3: 1.2 }       /* 測定：ギター1（旋律・ソロ）が、ギター2のラスゲアードより 7dB 小さかった */
};
/* 実音らしさ：ピッチ（±4セント）と強さ（±2.5）の、音ごとの小さなばらつき（同じ音でも毎回少し違う）。曲の中の位置と音高から決まるので、再生・書き出しとも同じになる */
function noteJitter(t, p, k) { var x = Math.sin(t * 12.9898 + p * 78.233 + k * 37.719) * 43758.5453; return x - Math.floor(x); }
var JITTER_SKIP = { drums: 1, perc: 1, perc2: 1, perc3: 1, timp: 1, jaleo: 1, cante: 1 };
var JITTER_STYLE_SKIP = { chip: 1, indian: 1, contemporary: 1, chaos: 1, djent: 1 };
Engine.prototype.load = function (song, thin) {
  var spb = 60 / song.opt.tempo, evs = [], i, k, sTrim = (song.opt && STEM_TRIM[song.opt.style]) || {}, jit = !(song.opt && JITTER_STYLE_SKIP[song.opt.style]) && this.real !== false;
  this.thin = !!thin;
  for (i = 0; i < song.stems.length; i++) {
    var s = song.stems[i];
    for (k = 0; k < s.notes.length; k++) {
      var n = s.notes[k];
      if (thin && s.id === "comp" && (n.t % 1 > 0.3 && n.t % 1 < 0.9)) continue;
      if (thin && s.id === "drums" && Math.abs(n.t % 1 - 0.5) < 0.02 && Math.random() < 0.6) continue;
      if (thin && (s.id === "perc" || s.id === "perc2" || s.id === "perc3") && (n.p === 70 || n.p === 82 || n.p === 69) && Math.random() < 0.7) continue;
      if (thin && (s.id === "perc" || s.id === "perc2" || s.id === "perc3") && n.v < 55 && Math.random() < 0.5) continue;
      var tr1 = sTrim[s.id], vv = (tr1 && tr1 !== 1) ? Math.min(127, n.v * tr1) : n.v, mm = n.micro || 0;
      if (jit && !JITTER_SKIP[s.id]) {
        var j1 = noteJitter(n.t, n.p, 1), j2 = noteJitter(n.t, n.p, 2);
        mm += (j1 - 0.5) * 0.08; vv = Math.max(1, Math.min(127, vv + (j2 - 0.5) * 5));
      }
      evs.push({ s: n.t * spb, d: Math.max(0.05, n.d * spb), p: n.p, v: vv, k: (song.guitarTrio && s.id === "solo" && n.fx) ? "gtrg" : s.id, mic: mm, g: n.g || 0, gd: n.gd ? n.gd * spb : 0, ao: n.ao || 0, vw: n.vw || 0, fl: n.fl || 0, ar: n.ar || 0 });
    }
  }
  evs.sort(function (a, b) { return a.s - b.s; });
  this.evs = evs; this.song = song; this.spb = spb;
  this.driveBus = {};
  /* テーマの楽器を選んでいれば、その音で鳴らす */
  var li = song.opt && song.opt.leadInst;
  this.leadOverride = (li === "guitar") ? "pluck" : (li === "piano" ? "piano" : (li === "sax" ? "horn" : null));
  var kt = { piano: "piano", organ: "organ", ballad: "piano", quartal: "piano", continuo: "harpsi" };
  this.keyType = kt[song.sty.comp] || "";
  var newTone = TONE[song.opt.toneOf || song.opt.style] || TONE.swing;   /* ぶっ飛びは他の様式の鳴り方を借りる */
  if (!this.tone || this.tone.bank !== newTone.bank) this.gtrReady = false;
  this.tone = newTone;
  this.sfProg = {};
  for (i = 0; i < song.stems.length; i++) this.sfProg[song.stems[i].id] = song.stems[i].prog | 0;
  if (this.sfProg.solo != null) this.sfProg.gtrg = this.sfProg.solo;                     /* ギタートリオのラスゲアードは、ギター2の音色で */
  this._sfPrepSong = null;
  this.sfCurves = this.sfCurvesOf(song, spb);
  this.instLead = instrOf(song.sty.lead);
  this.instComp = instrOf(song.sty.compProg);
  return evs.length;
};
Engine.prototype.play = function (fromBeat) {
  var self = this;
  this.ensure();
  if (this.sfUse() && this._sfPrepSong !== this.song) {
    var tk = this._sfTk = (this._sfTk || 0) + 1;
    this.sfPrepare(this.onSfStatus).then(function () { if (self._sfTk === tk) self.play(fromBeat); });
    return;
  }
  this.buildBank();
  if (!this.gains.mel) {
    ["mel", "solo", "gt3", "gtrg", "gtr2", "wfl", "wsx", "comp", "pno", "bass", "drums", "perc", "perc2", "perc3", "jaleo", "cante", "horn", "harp", "timp", "cello", "fl", "ob", "cl", "bsn", "tpt", "trb", "tuba"].forEach(function (k) { self.gains[k] = self.chain(k); });
  }
  this.applyPan();
  this.startBeat = fromBeat || 0;
  var startSec = this.startBeat * this.spb;
  this.idx = 0;
  while (this.idx < this.evs.length && this.evs[this.idx].s < startSec) this.idx++;
  this.t0 = this.ctx.currentTime + 0.18 - startSec;
  this.rotarySetup(startSec);
  if (this.sfUse()) this.sfExprSetup(startSec); else this.sfExprTeardown();
  this.playing = true;
  var pump = function () {
    if (!self.playing || !self.ctx) return;
    var now = self.ctx.currentTime, ahead = now + 0.5;                  /* 先読みを広めに：処理が一瞬詰まっても音が途切れない */
    while (self.idx < self.evs.length && self.t0 + self.evs[self.idx].s < ahead) {
      var e = self.evs[self.idx++];
      if (self.t0 + e.s < now - 0.04) {                                 /* 間に合わなかった音：続くようなら飾りの層を止めて軽くする */
        self._late = (self._late || 0) + 1;
        if (self._late > 8 && !self._noExtra) self._noExtra = true;
      }
      if (!self.mute[e.k]) {
        try { self.voice(e.k, e.p + (e.mic || 0), Math.max(now, self.t0 + e.s), e.d, e.v, e.g, e.gd, e.ao, e.vw, e.fl, e.ar); } catch (x) {}
      }
    }
    self.pumpLoop(now, ahead);
    if (self.idx >= self.evs.length && self.evs.length &&
        self.t0 + self.evs[self.evs.length - 1].s + 1.5 < now) { var cbEnd = self.onEnd; self.stop(); if (cbEnd) { try { cbEnd(); } catch (xe) {} } }   /* 曲の終わり（onEnd：無限再生・ボタンの表示戻し用） */
  };
  this._late = 0; this._noExtra = false;
  this.stopLoopSrcs();
  if (this.loop && this.loop.on) this._lk = Math.max(0, Math.floor(((fromBeat || 0) - this.loop.start) / (this.loop.bars * this.loop.bpb)));
  this.timer = setInterval(pump, 45);
  var loop = function () {
    if (!self.playing) return;
    pump();
    if (self.onTick) self.onTick((self.ctx.currentTime - self.t0) / self.spb);
    self.raf = requestAnimationFrame(loop);
  };
  loop();
};
Engine.prototype.setMute = function (k, on) {
  this.mute[k] = on;
  if (k === "solo") { this.mute.gtrg = on; if (this.gains.gtrg) this.gains.gtrg.gain.value = on ? 0 : MIX.gtrg.gain; }
  if (this.gains[k]) this.gains[k].gain.value = on ? 0 : (MIX[k] ? MIX[k].gain : 1) * ((this.volMul && this.volMul[k]) || 1);
};

/* ---------- 保存 ---------- */
/* Artifact の中（downloads 機能がある所）では、直接のダウンロードが許されない。
   許可される拡張子に .mid／.musicxml が無いので、zip に入れて claude.downloads.save で渡す。 */
var DL = null;
try { if (root.claude && typeof root.claude.use === "function") root.claude.use("downloads").then(function (d) { DL = d || null; }, function () {}); } catch (x) {}
var CRCT = null;
function crc32(u8) {
  var n, k, c;
  if (!CRCT) { CRCT = []; for (n = 0; n < 256; n++) { c = n; for (k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); CRCT[n] = c >>> 0; } }
  c = 0xFFFFFFFF;
  for (n = 0; n < u8.length; n++) c = CRCT[(c ^ u8[n]) & 255] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
/* 無圧縮の zip（files: [{name, data:Uint8Array}]）→ Blob */
function zipStore(files) {
  var enc = new TextEncoder(), parts = [], cd = [], off = 0, i;
  for (i = 0; i < files.length; i++) {
    var nm = enc.encode(files[i].name), d = files[i].data, crc = crc32(d), sz = d.length;
    var h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint16(10, 0, true); h.setUint16(12, 0x21, true); h.setUint32(14, crc, true); h.setUint32(18, sz, true);
    h.setUint32(22, sz, true); h.setUint16(26, nm.length, true); h.setUint16(28, 0, true);
    parts.push(new Uint8Array(h.buffer), nm, d);
    var c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
    c.setUint16(10, 0, true); c.setUint16(12, 0, true); c.setUint16(14, 0x21, true); c.setUint32(16, crc, true);
    c.setUint32(20, sz, true); c.setUint32(24, sz, true); c.setUint16(28, nm.length, true); c.setUint32(42, off, true);
    cd.push(new Uint8Array(c.buffer), nm);
    off += 30 + nm.length + sz;
  }
  var cdSize = 0; for (i = 0; i < cd.length; i++) cdSize += cd[i].length;
  var ed = new DataView(new ArrayBuffer(22));
  ed.setUint32(0, 0x06054b50, true); ed.setUint16(8, files.length, true); ed.setUint16(10, files.length, true);
  ed.setUint32(12, cdSize, true); ed.setUint32(16, off, true);
  return new Blob(parts.concat(cd, [new Uint8Array(ed.buffer)]), { type: "application/zip" });
}
function dlReady() { return !!DL; }
/* list: [{name, bytes} | {name, text}] を1つの zip にして保存（Artifact の中だけ。使えなければ false） */
function saveFiles(list, zipName, statusEl) {
  if (!DL) return false;
  var enc = new TextEncoder(), files = list.map(function (f) {
    return { name: f.name, data: typeof f.text === "string" ? enc.encode(f.text) : (f.bytes instanceof Uint8Array ? f.bytes : new Uint8Array(f.bytes)) };
  });
  if (statusEl) statusEl.textContent = zipName + " を用意しました。確認の画面で保存してください。";
  DL.save({ filename: zipName, data: zipStore(files) }).then(function () {
    if (statusEl) statusEl.textContent = zipName + " を保存しました（" + files.length + " ファイル入りの zip。展開すると .mid／.musicxml が出てきます）。";
  }, function (er) {
    if (statusEl) statusEl.textContent = (er && er.code === "declined") ? "保存をキャンセルしました。" : "保存できませんでした（" + ((er && er.code) || "error") + "）。";
  });
  return true;
}
function zipNameOf(name) { return name.replace(/\.[^.]+$/, "") + ".zip"; }
function saveBytes(bytes, name, statusEl) {
  if (saveFiles([{ name: name, bytes: bytes }], zipNameOf(name), statusEl)) return;
  var blob = new Blob([bytes], { type: /\.pdf$/i.test(name) ? "application/pdf" : (/\.mp3$/i.test(name) ? "audio/mpeg" : (/\.wav$/i.test(name) ? "audio/wav" : "audio/midi")) });
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url; a.download = name; a.style.display = "none";
  document.body.appendChild(a);
  try { a.click(); } catch (e) {}
  setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 4000);
  if (statusEl) statusEl.textContent = name + " の保存を試みました。保存されない場合は「📨 チャットで受け取る」を使ってください。";
}
function saveText(text, name, mime, statusEl) {
  if (saveFiles([{ name: name, text: text }], zipNameOf(name), statusEl)) return;
  var blob = new Blob([text], { type: mime || "text/plain" });
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url; a.download = name; a.style.display = "none";
  document.body.appendChild(a);
  try { a.click(); } catch (e) {}
  setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 4000);
  if (statusEl) statusEl.textContent = name + " の保存を試みました。保存されない場合は「📨 チャットで受け取る」を使ってください。";
}
function shareBytes(bytes, name, statusEl) {
  if (saveFiles([{ name: name, bytes: bytes }], zipNameOf(name), statusEl)) return true;
  try {
    var file = new File([bytes], name, { type: "audio/midi" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: name }).catch(function () {});
      return true;
    }
  } catch (e) {}
  if (statusEl) statusEl.textContent = "この画面では共有できません。「📨 チャットで受け取る」を押して、コピーされた文をチャットに貼ってください。";
  return false;
}

/* ---------- ピアノロール ---------- */
var COLORS = { mel: "#f0c674", solo: "#e2703a", gt3: "#8fc3e8", comp: "#7fa88a", bass: "#8a9fd1", drums: "#7b6f63", perc: "#9c7f68", perc2: "#b89a78", perc3: "#cdb894", jaleo: "#c8704a", cante: "#e0a090",
  horn: "#c98d4a", harp: "#b9a7e0", timp: "#a0786a", cello: "#8fb7a0",
  fl: "#d9e8f5", ob: "#c4b06a", cl: "#9fc4d8", bsn: "#9c8a6e", tpt: "#f2b84b", trb: "#d08a3c", tuba: "#a86a3a" };
drawRoll._paint = function (g, song, w, h, dpr, mute) {
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);

  var lo = 127, hi = 0, i, k;
  for (i = 0; i < song.stems.length; i++) {
    if (song.stems[i].id === "drums" || song.stems[i].id === "perc" || song.stems[i].id === "perc2" || song.stems[i].id === "perc3") continue;
    for (k = 0; k < song.stems[i].notes.length; k++) {
      var p = song.stems[i].notes[k].p;
      if (p < lo) lo = p; if (p > hi) hi = p;
    }
  }
  if (hi <= lo) { lo = 40; hi = 80; }
  lo -= 2; hi += 2;
  var tb = song.totalBeats;
  g.strokeStyle = "rgba(240,198,116,.22)";
  if (song.sections) {
    for (i = 0; i < song.sections.length; i++) {
      var x = song.sections[i].at / tb * w;
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
      g.fillStyle = "rgba(240,198,116,.55)";
      g.font = "9px -apple-system,sans-serif";
      g.fillText(song.sections[i].kind, x + 3, 10);
    }
  } else {
    var bl0 = song.sheet && song.sheet.barLens, bpc = bl0 && bl0.length ? bl0.reduce(function (a, b) { return a + b; }, 0) : song.barsPerChorus * song.beats;
    for (i = 0; i <= song.order.length; i++) {
      var x2 = i * bpc / tb * w;
      g.beginPath(); g.moveTo(x2, 0); g.lineTo(x2, h); g.stroke();
    }
  }
  var ph = Math.max(2, (h - 4) / (hi - lo + 1));
  for (i = 0; i < song.stems.length; i++) {
    var s = song.stems[i];
    if (s.id === "drums" || s.id === "perc" || s.id === "perc2" || s.id === "perc3") continue;
    g.fillStyle = mute && mute[s.id] ? "rgba(120,110,100,.25)" : COLORS[s.id];
    for (k = 0; k < s.notes.length; k++) {
      var n = s.notes[k];
      var X = n.t / tb * w, W = Math.max(1.2, n.d / tb * w);
      var Y = h - 2 - (n.p - lo + 1) * ph;
      g.fillRect(X, Y, W, Math.max(1.5, ph - 0.6));
    }
  }
};
/* オーケストラ譜（現代音楽）：横に長い譜面。楽器ごとの色・セットの音のレーン・小節と秒の目盛り・再生位置。
   凡例（楽器名）をタップすると消音／鳴るを切り替える（cv._legend に当たり判定）。 */
var ORCH_PPB = 11, ORCH_H = 340, ORCH_PAD = { l: 34, t: 40, b: 22 };
var ORCH_NN = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
function orchScore(cv, song, playBeat, mute) {
  var box = cv.parentNode, dpr = Math.min(2, root.devicePixelRatio || 1);
  var vis = (box && box.clientWidth) || 600;
  var tb = song.totalBeats, W = Math.min(16000, Math.max(vis, Math.ceil(tb * ORCH_PPB) + ORCH_PAD.l + 20)), H = ORCH_H;
  var stems = song.stems.filter(function (s) { return s.id !== "drums" && s.id !== "perc" && s.id !== "perc2" && s.id !== "perc3" && s.notes.length; });
  var key = [song.totalBeats, stems.length, W, dpr, stems.map(function (s) { return mute && mute[s.id] ? 1 : 0; }).join("")].join("|");
  if (cv._key !== key || cv._song !== song || !cv._layer) {
    cv.style.width = W + "px"; cv.style.height = H + "px";
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    var off = document.createElement("canvas"); off.width = cv.width; off.height = cv.height;
    var g = off.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    var P = ORCH_PAD, x0 = P.l, w = W - P.l - 10, y0 = P.t, h = H - P.t - P.b;
    var lo = 127, hi = 0, i, k, pcs = (song.opt && song.opt.ct && song.opt.ct.pcs) || [];
    if (song.indian) pcs = song.indian.pcs.map(function (p) { return (p + song.indian.sa) % 12; });
    stems.forEach(function (s) { s.notes.forEach(function (n) { if (n.p < lo) lo = n.p; if (n.p > hi) hi = n.p; }); });
    if (hi <= lo) { lo = 48; hi = 84; }
    lo -= 2; hi += 2;
    var rows = hi - lo + 1, rh = h / rows;
    function px(t) { return x0 + t / tb * w; }
    function py(p) { return y0 + h - (p - lo + 1) * rh; }
    g.fillStyle = "#0f0c09"; g.fillRect(0, 0, W, H);
    /* 音のレーン：セットの音は明るく、黒鍵は暗く */
    for (var p = lo; p <= hi; p++) {
      var pc = ((p % 12) + 12) % 12, y = py(p);
      if (pcs.indexOf(pc) >= 0) { g.fillStyle = "rgba(240,198,116,.10)"; g.fillRect(x0, y, w, rh); }
      else if ([1, 3, 6, 8, 10].indexOf(pc) >= 0) { g.fillStyle = "rgba(0,0,0,.25)"; g.fillRect(x0, y, w, rh); }
      if (pc === 0) {
        g.strokeStyle = "rgba(255,255,255,.14)"; g.lineWidth = 0.6;
        g.beginPath(); g.moveTo(x0, y + rh); g.lineTo(x0 + w, y + rh); g.stroke();
        g.fillStyle = "rgba(232,221,200,.6)"; g.font = "9px -apple-system,sans-serif"; g.textAlign = "right";
        g.fillText("C" + (Math.floor(p / 12) - 1), x0 - 4, y + rh - 1);
      }
    }
    g.textAlign = "left";
    /* 小節線（4拍ごと）と秒の目盛り */
    var tempo = (song.opt && song.opt.tempo) || 60, secPerBeat = 60 / tempo, b;
    for (b = 0; b <= tb; b += 4) {
      g.strokeStyle = (b % 16 === 0) ? "rgba(240,198,116,.28)" : "rgba(255,255,255,.07)"; g.lineWidth = 0.6;
      g.beginPath(); g.moveTo(px(b), y0); g.lineTo(px(b), y0 + h); g.stroke();
    }
    var gs = tb * secPerBeat > 120 ? 20 : 10, sec;
    g.fillStyle = "rgba(232,221,200,.55)"; g.font = "10px -apple-system,sans-serif";
    for (sec = 0; sec <= tb * secPerBeat; sec += gs) {
      var xs = px(sec / secPerBeat);
      g.fillText(Math.floor(sec / 60) + ":" + (sec % 60 < 10 ? "0" : "") + (sec % 60), xs + 2, H - 7);
      g.strokeStyle = "rgba(240,198,116,.4)"; g.beginPath(); g.moveTo(xs, y0 + h); g.lineTo(xs, y0 + h + 4); g.stroke();
    }
    /* 起承転結などの区切り */
    if (song.sections) song.sections.forEach(function (sc) {
      g.fillStyle = "rgba(240,198,116,.6)"; g.font = "9px -apple-system,sans-serif";
      g.fillText(sc.kind || "", px(sc.at) + 3, y0 - 4);
    });
    /* 音符：楽器ごとの色。消音は灰色 */
    var nh = Math.max(3, rh * 0.8);
    stems.forEach(function (s) {
      var off2 = mute && mute[s.id];
      g.fillStyle = off2 ? "rgba(120,110,100,.28)" : (COLORS[s.id] || "#ccc");
      s.notes.forEach(function (n) {
        var xx = px(n.t), ww = Math.max(2, n.d / tb * w - 0.5);
        g.globalAlpha = off2 ? 1 : (0.55 + 0.45 * Math.min(1, (n.v || 80) / 110));
        g.fillRect(xx, py(n.p) + (rh - nh) / 2, ww, nh);
      });
    });
    g.globalAlpha = 1;
    /* 凡例（楽器名）：タップで消音の切替 */
    cv._legend = [];
    var lx = x0, ly = 16;
    g.font = "12px -apple-system,sans-serif";
    stems.forEach(function (s) {
      var label = s.jp || s.id, tw = g.measureText(label).width, off3 = mute && mute[s.id];
      g.fillStyle = off3 ? "rgba(120,110,100,.5)" : (COLORS[s.id] || "#ccc");
      g.fillRect(lx, ly - 9, 10, 10);
      g.fillStyle = off3 ? "rgba(232,221,200,.35)" : "rgba(232,221,200,.9)";
      g.fillText(label + (off3 ? "（消音）" : ""), lx + 14, ly);
      var tw2 = g.measureText(label + (off3 ? "（消音）" : "")).width;
      cv._legend.push({ x0: lx, x1: lx + 14 + tw2, y0: ly - 14, y1: ly + 6, id: s.id });
      lx += 14 + tw2 + 16;
    });
    cv._layer = off; cv._key = key; cv._song = song; cv._geo = { x0: x0, w: w, y0: y0, h: h };
  }
  var c = cv.getContext("2d");
  c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, cv.width, cv.height); c.drawImage(cv._layer, 0, 0);
  if (playBeat != null) {
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    var xp = cv._geo.x0 + playBeat / tb * cv._geo.w;
    c.strokeStyle = "#e8ddc8"; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(xp, cv._geo.y0 - 6); c.lineTo(xp, cv._geo.y0 + cv._geo.h); c.stroke();
    if (box && (xp < box.scrollLeft + 20 || xp > box.scrollLeft + vis - 40)) box.scrollLeft = Math.max(0, xp - vis * 0.25);
  }
}
function orchHook(song, playBeat, mute) {
  if (typeof document === "undefined") return;
  var cv = document.getElementById("orchScore"); if (!cv || !cv.getContext) return;
  var wrap = document.getElementById("orchBox");
  var on = !!(song && (song.contemporary || song.indian));
  if (wrap) wrap.style.display = on ? "" : "none";
  if (!on) return;
  if (wrap && wrap.tagName === "DETAILS" && !wrap.open) return;
  orchScore(cv, song, playBeat, mute);
}
function drawRoll(cv, song, playBeat, mute) {
  if (!song) return;
  var dpr = Math.min(2, root.devicePixelRatio || 1);
  var w = cv.clientWidth, h = cv.clientHeight;
  if (!(w > 0) || !(h > 0)) return;                 /* まだ画面に出ていないときは描かない */
  if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
  var g = cv.getContext && cv.getContext("2d");
  if (!g || !(cv.width > 0) || !(cv.height > 0)) return;
  /* 音符と枠は描き直さず、一度だけ別の画布に描いて使い回す。
     再生中は縦棒だけ描く＝描画が音の処理を邪魔しない（音切れ対策） */
  var key = [song.totalBeats, song.stems.length, w, h, dpr,
    (mute ? [mute.mel, mute.solo, mute.comp, mute.bass, mute.drums, mute.perc, mute.horn, mute.harp, mute.timp, mute.cello].join("") : "")].join("|");
  if (drawRoll._song !== song || drawRoll._key !== key || !drawRoll._layer) {
    var off = (typeof document !== "undefined" && document.createElement) ? document.createElement("canvas") : null;
    if (off) {
      off.width = cv.width; off.height = cv.height;
      var g2 = (off.width > 0 && off.height > 0 && off.getContext) ? off.getContext("2d") : null;
      if (g2) {
        drawRoll._layer = off; drawRoll._song = song; drawRoll._key = key;
        drawRoll._paint(g2, song, w, h, dpr, mute);
      }
    }
  }
  if (drawRoll._layer && drawRoll._layer.width > 0 && drawRoll._layer.height > 0 &&
      drawRoll._song === song && drawRoll._key === key) {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, cv.width, cv.height);
    g.drawImage(drawRoll._layer, 0, 0);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (playBeat != null) {
      var xp = playBeat / song.totalBeats * w;
      g.strokeStyle = "#e8ddc8"; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(xp, 0); g.lineTo(xp, h); g.stroke();
    }
    return;
  }
  drawRoll._paint(g, song, w, h, dpr, mute);
  if (playBeat != null) {
    var xq = playBeat / song.totalBeats * w;
    g.strokeStyle = "#f0c674"; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(xq, 0); g.lineTo(xq, h); g.stroke();
  }
}

/* ---------- 五線譜（テーマの確認用）----------
   外部ライブラリなしで SVG に描く。ト音記号・調号・拍子・音符（符頭・符幹・旗・連桁）・
   付点・臨時記号・加線・タイ・休符・3連・コードネームまで。 */
function drawScore(el, song, HH) {
  if (!el || !song || !HH || !HH.scoreData) return;
  var sc = HH.scoreData(song), DV = sc.div;
  /* 分母8（9/8 など）は、連桁を拍のまとまり（2+2+2+3 など）で組む。4分の拍子は従来どおり1拍ごと */
  var GB = null;
  if (sc.groups && sc.ts && sc.ts[1] === 8) { GB = []; var acc0 = 0; sc.groups.forEach(function (g) { acc0 += g * DV / 2; GB.push(acc0); }); }
  function beamBeat(s) { if (!GB) return Math.floor(s / DV); for (var z = 0; z < GB.length; z++) if (s < GB[z] - 0.001) return z; return GB.length; }
  var melStem = (song.stems || []).filter(function (x) { return x.id === "mel"; })[0];
  var gtr = melStem && melStem.prog >= 24 && melStem.prog <= 31;   /* ギターは移調楽器：1オクターヴ上に書く */
  if (gtr) {
    sc.measures.forEach(function (m) {
      m.events.forEach(function (e) { if (!e.rest) { e.oct += 1; e.p += 12; } });
    });
  }
  var W0 = Math.max(320, el.clientWidth || (el.getAttribute && parseInt(el.getAttribute("data-w"), 10)) || 900);
  var SP = 8;                                       /* 線の間隔 */
  /* 音ごとの幅：短い音でも最低限の間を取り、長い音ほど少し広く（浄書の考え方） */
  function evWeight(e) {
    var w = 1 + 0.55 * Math.log(Math.max(1, e.dur) / (DV / 2)) / Math.LN2;
    if (!e.rest && e.alter !== 0) w += 0.35;        /* 臨時記号のぶん */
    return Math.max(0.85, w);
  }
  var UNIT = 17;                                    /* 重み1あたりの幅（px） */
  var need = sc.measures.map(function (m) {
    var w = 0, q;
    for (q = 0; q < m.events.length; q++) w += evWeight(m.events[q]);
    return Math.max(120, w * UNIT + 26) + (m.ts ? 20 : 0);     /* 拍子の変わり目は拍子記号のぶん広げる */
  });
  /* 段に詰める：入りきらなければ次の段へ。1小節で幅を超えるときは横に広げる */
  var HEAD0 = 90, HEADn = 62;
  var systems = [], cur2 = [], used = 0, avail = W0 - HEAD0 - 10;
  for (var mq = 0; mq < sc.measures.length; mq++) {
    if (cur2.length && used + need[mq] > avail) {
      systems.push(cur2); cur2 = []; used = 0; avail = W0 - HEADn - 10;
    }
    cur2.push(mq); used += need[mq];
  }
  if (cur2.length) systems.push(cur2);
  var W = W0;
  for (var sq = 0; sq < systems.length; sq++) {
    var tw = (sq === 0 ? HEAD0 : HEADn) + 10;
    for (var sr = 0; sr < systems[sq].length; sr++) tw += need[systems[sq][sr]];
    if (tw > W) W = Math.ceil(tw);
  }
  var nSys = systems.length;
  var SYS_H = SP * 4 + 92;
  var H = nSys * SYS_H + 30;
  var svg = [];
  function add(x) { svg.push(x); }
  function line(x1, y1, x2, y2, w, c) {
    add('<line x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) + '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) +
      '" stroke="' + (c || "#2a241c") + '" stroke-width="' + (w || 1) + '"/>');
  }
  function text(x, y, s, size, anchor, weight, fill, family) {
    add('<text x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" font-size="' + size + '" text-anchor="' + (anchor || "start") +
      '" font-weight="' + (weight || "normal") + '" fill="' + (fill || "#2a241c") + '" font-family="' +
      (family || "Georgia,Times,serif") + '">' + s + '</text>');
  }
  var LET = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
  /* 下の線（E4）を0として、半間ずつの位置 */
  function posOf(step, oct) { return (LET[step] + oct * 7) - (2 + 4 * 7); }
  /* 調号 */
  var SHARP_POS = [8, 5, 9, 6, 3, 7, 4], FLAT_POS = [4, 7, 3, 6, 2, 5, 1];
  var SHARP_ORD = ["F", "C", "G", "D", "A", "E", "B"], FLAT_ORD = ["B", "E", "A", "D", "G", "C", "F"];
  var keyAlt = {};
  var k, i;
  if (sc.fifths > 0) for (k = 0; k < sc.fifths; k++) keyAlt[SHARP_ORD[k]] = 1;
  if (sc.fifths < 0) for (k = 0; k < -sc.fifths; k++) keyAlt[FLAT_ORD[k]] = -1;

  /* ト音記号：G線（下から2本目）を渦の中心にして描く */
  function clef(x, top) {
    var g = top + SP * 3, cx = x + 8;
    add('<path d="' +
      /* 下の尾 */
      'M' + (cx - 3) + ',' + (g + 21) + ' C' + (cx - 8) + ',' + (g + 21) + ' ' + (cx - 8) + ',' + (g + 14) + ' ' + (cx - 3) + ',' + (g + 14) +
      ' C' + (cx + 1) + ',' + (g + 14) + ' ' + (cx + 2) + ',' + (g + 19) + ' ' + (cx - 1) + ',' + (g + 20) +
      /* 縦の軸を上へ */
      ' M' + (cx - 1) + ',' + (g + 20) + ' C' + (cx + 1) + ',' + (g + 12) + ' ' + (cx + 1) + ',' + (g - 6) + ' ' + (cx + 1) + ',' + (g - 16) +
      /* 上の輪 */
      ' C' + (cx + 1) + ',' + (g - 24) + ' ' + (cx + 7) + ',' + (g - 27) + ' ' + (cx + 7) + ',' + (g - 20) +
      ' C' + (cx + 7) + ',' + (g - 13) + ' ' + (cx - 8) + ',' + (g - 8) + ' ' + (cx - 8) + ',' + (g + 2) +
      /* G線を巻く渦 */
      ' C' + (cx - 8) + ',' + (g + 10) + ' ' + (cx + 8) + ',' + (g + 11) + ' ' + (cx + 8) + ',' + (g + 2) +
      ' C' + (cx + 8) + ',' + (g - 4) + ' ' + (cx) + ',' + (g - 6) + ' ' + (cx - 3) + ',' + (g - 1) +
      ' C' + (cx - 5) + ',' + (g + 3) + ' ' + (cx - 1) + ',' + (g + 6) + ' ' + (cx + 2) + ',' + (g + 4) +
      '" fill="none" stroke="#2a241c" stroke-width="1.7" stroke-linecap="round"/>');
    add('<circle cx="' + (cx - 4) + '" cy="' + (g + 18) + '" r="2.6" fill="#2a241c"/>');
    if (gtr) text(cx - 2, g + 33, "8", 10, "middle", "bold");
  }
  function keySig(x, top) {
    var n = Math.abs(sc.fifths), sharp = sc.fifths > 0, j;
    for (j = 0; j < n; j++) {
      var ps = sharp ? SHARP_POS[j] : FLAT_POS[j];
      var yy = top + SP * 4 - ps * SP / 2;
      text(x + j * 7, yy + (sharp ? 4 : 3), sharp ? "♯" : "♭", 15, "middle");
    }
    return n * 7;
  }
  function timeSig(x, top, ts2) {
    var t2 = ts2 || sc.ts;
    text(x, top + SP * 2 - 1, String(t2[0]), 17, "middle", "bold");
    text(x, top + SP * 4 - 1, String(t2[1]), 17, "middle", "bold");
  }
  function restGlyph(x, top, type) {
    var mid = top + SP * 2;
    if (type === "whole") { add('<rect x="' + (x - 5) + '" y="' + (top + SP) + '" width="10" height="4" fill="#2a241c"/>'); return; }
    if (type === "half") { add('<rect x="' + (x - 5) + '" y="' + (top + SP * 2 - 4) + '" width="10" height="4" fill="#2a241c"/>'); return; }
    if (type === "quarter") {
      add('<path d="M' + (x - 2) + ',' + (mid - 10) + ' l5,6 l-5,5 l5,6 c-6,-2 -7,3 -2,7" fill="none" stroke="#2a241c" stroke-width="2"/>');
      return;
    }
    /* 8分・16分 */
    var flags = type === "eighth" ? 1 : 2, f;
    line(x + 2, mid - 6, x - 2, mid + 8, 1.4);
    for (f = 0; f < flags; f++) {
      add('<circle cx="' + (x - 2 + f * -1.5) + '" cy="' + (mid - 5 + f * 6) + '" r="2" fill="#2a241c"/>');
      add('<path d="M' + (x - 2 + f * -1.5) + ',' + (mid - 5 + f * 6) + ' q3,2 4,-1" fill="none" stroke="#2a241c" stroke-width="1.3"/>');
    }
  }

  /* トレモロ曲：上段＝旋律（全ての音を音符で書き、符幹にトレモロの斜線）、下段＝親指の低音（p）。拍の位置をそろえて2段で組む */
  if (song.yamtrem && song.sheet && song.sheet.bass && HH.scoreData) {
    var bsong = { opt: song.opt, title: song.title, stems: song.stems, sheet: Object.assign({}, song.sheet, { notes: song.sheet.bass }) };
    var scB = HH.scoreData(bsong);
    if (gtr) scB.measures.forEach(function (m) { m.events.forEach(function (e2) { if (!e2.rest) { e2.oct += 1; e2.p += 12; } }); });
    var nMe = sc.measures.length, perBar = sc.perBar, mq2;
    var need2 = [], maxPos = 8, minPosB = 0, maxPosB = 8;
    sc.measures.forEach(function (m) { m.events.forEach(function (e2) { if (!e2.rest) { var p0 = posOf(e2.step, e2.oct); if (p0 > maxPos) maxPos = p0; } }); });
    scB.measures.forEach(function (m) { m.events.forEach(function (e2) { if (!e2.rest) { var p1 = posOf(e2.step, e2.oct); if (p1 < minPosB) minPosB = p1; if (p1 > maxPosB) maxPosB = p1; } }); });
    for (mq2 = 0; mq2 < nMe; mq2++) {
      var cnt = Math.max(sc.measures[mq2].events.length, scB.measures[mq2] ? scB.measures[mq2].events.length : 0);
      need2.push(Math.max(150, cnt * 24 + 34));
    }
    var above = (maxPos - 8) * SP / 2 + 52, below = (-minPosB) * SP / 2 + 44, gap = Math.max(50, (maxPosB - 8) * SP / 2 + 46);
    var SYS2 = above + SP * 4 + gap + SP * 4 + below;
    var HEAD0g = 90, HEADng = 62, sys2 = [], cur3 = [], used3 = 0, avail3 = W0 - HEAD0g - 10;
    for (mq2 = 0; mq2 < nMe; mq2++) {
      if (cur3.length && used3 + need2[mq2] > avail3) { sys2.push(cur3); cur3 = []; used3 = 0; avail3 = W0 - HEADng - 10; }
      cur3.push(mq2); used3 += need2[mq2];
    }
    if (cur3.length) sys2.push(cur3);
    var Wg = W0, sg;
    sys2.forEach(function (s3, ix) { var t3 = (ix === 0 ? HEAD0g : HEADng) + 10; s3.forEach(function (m3) { t3 += need2[m3]; }); if (t3 > Wg) Wg = Math.ceil(t3); });
    var Hg = sys2.length * SYS2 + 40;
    add('<svg xmlns="http://www.w3.org/2000/svg" width="' + Wg + '" height="' + Hg + '" viewBox="0 0 ' + Wg + ' ' + Hg + '" data-sysh="' + SYS2 + '" data-sysn="' + sys2.length + '" style="background:#fbf8f1;border-radius:6px">');
    text(Wg / 2, 20, (song.title || "").replace(/&/g, "&amp;").replace(/</g, "&lt;"), 14, "middle", "bold");
    text(14, 20, "♩ = " + sc.tempo, 11, "start");
    text(Wg / 2, 36, "上段＝旋律（トレモロ・全ての音を表記）／下段＝親指の低音（p）", 10, "middle", "normal", "#8a7f6c", "-apple-system,Helvetica,sans-serif");
    function noteAt(ev, x, top, up, slash, memo, tie, sy3) {
      var ps3 = posOf(ev.step, ev.oct), y3 = top + SP * 4 - ps3 * SP / 2, lp3;
      for (lp3 = -2; lp3 >= ps3; lp3 -= 2) line(x - 7, top + SP * 4 - lp3 * SP / 2, x + 7, top + SP * 4 - lp3 * SP / 2, 1);
      for (lp3 = 10; lp3 <= ps3; lp3 += 2) line(x - 7, top + SP * 4 - lp3 * SP / 2, x + 7, top + SP * 4 - lp3 * SP / 2, 1);
      var want3 = ev.alter, keyA3 = keyAlt[ev.step] || 0, lk3 = ev.step + ev.oct;
      var cur4 = (lk3 in memo) ? memo[lk3] : keyA3;
      if (want3 !== cur4 && !ev.tieEnd) { text(x - 11, y3 + 4, want3 > 0 ? "♯" : (want3 < 0 ? "♭" : "♮"), 14, "middle"); memo[lk3] = want3; }
      var hollow3 = (ev.type === "half" || ev.type === "whole");
      add('<ellipse cx="' + x.toFixed(1) + '" cy="' + y3.toFixed(1) + '" rx="4.9" ry="3.6" transform="rotate(-22 ' + x.toFixed(1) + ' ' + y3.toFixed(1) +
        ')" fill="' + (hollow3 ? "#fbf8f1" : "#2a241c") + '" stroke="#2a241c" stroke-width="1.3"/>');
      if (ev.dots) add('<circle cx="' + (x + 8) + '" cy="' + (y3 - (ps3 % 2 === 0 ? 3 : 0)) + '" r="1.5" fill="#2a241c"/>');
      if (ev.type !== "whole") {
        var sx3 = up ? x + 4.4 : x - 4.4, sy4 = up ? y3 - SP * 3.5 : y3 + SP * 3.5;
        line(sx3, y3, sx3, sy4, 1.2);
        if (slash) { var my3 = (y3 + sy4) / 2, s5; for (s5 = 0; s5 < 3; s5++) line(sx3 - 4.5, my3 + s5 * 3.2, sx3 + 4.5, my3 + s5 * 3.2 - 4.4, 1.6); }
        if (ev.type === "eighth" || ev.type === "16th") {
          var nf3 = ev.type === "eighth" ? 1 : 2, f3;
          for (f3 = 0; f3 < nf3; f3++) { var fy3 = sy4 + (up ? f3 * 6 : -f3 * 6); add('<path d="M' + sx3 + ',' + fy3 + ' q7,' + (up ? 5 : -5) + ' 5,' + (up ? 13 : -13) + '" fill="none" stroke="#2a241c" stroke-width="1.5"/>'); }
        }
      }
      if (tie.from && ev.tieEnd) {
        var tx3 = tie.from.x, ty3 = y3 + 7;
        if (tie.from.sys !== sy3) tx3 = x - 22;
        add('<path d="M' + (tx3 + 4) + ',' + ty3 + ' Q' + ((tx3 + x) / 2) + ',' + (ty3 + 7) + ' ' + (x - 4) + ',' + ty3 + '" fill="none" stroke="#2a241c" stroke-width="1.1"/>');
      }
      tie.from = ev.tieStart ? { x: x, sys: sy3 } : null;
    }
    var tieM = { from: null }, tieB = { from: null };
    for (sg = 0; sg < sys2.length; sg++) {
      var topM = 30 + sg * SYS2 + above, topB = topM + SP * 4 + gap;
      var staffEnd2 = Wg - 10;
      clef(16, topM); clef(16, topB);
      var kx2 = 40, kw2 = keySig(kx2, topM); keySig(kx2, topB);
      var startX2 = kx2 + kw2 + 8;
      if (sg === 0) { timeSig(startX2 + 6, topM); timeSig(startX2 + 6, topB); startX2 += 20; }
      var need3 = 0; sys2[sg].forEach(function (m3) { need3 += need2[m3]; });
      var isLast2 = (sg === sys2.length - 1);
      var scale2 = isLast2 ? Math.min(1.35, (Wg - 10 - startX2) / need3) : (Wg - 10 - startX2) / need3;
      text(12, topM - 14, String(sys2[sg][0] + 1), 9, "start", "normal", "#8a7f6c");
      line(11, topM, 11, topB + SP * 4, 1.6);                                   /* 2段をつなぐ縦線 */
      var mx2 = startX2, j3;
      for (j3 = 0; j3 < sys2[sg].length; j3++) {
        var mi3 = sys2[sg][j3], mW2 = need2[mi3] * scale2, mxx = mx2;
        mx2 += mW2;
        line(mxx + mW2, topM, mxx + mW2, topB + SP * 4, 1);
        var memoM = {}, memoB = {};
        var evM = sc.measures[mi3].events, evB = scB.measures[mi3] ? scB.measures[mi3].events : [], q3;
        for (q3 = 0; q3 < evM.length; q3++) {
          var xM = mxx + 14 + (evM[q3].s / perBar) * (mW2 - 26);
          if (evM[q3].rest) { restGlyph(xM, topM, evM[q3].type); tieM.from = null; continue; }
          noteAt(evM[q3], xM, topM, true, true, memoM, tieM, sg);
        }
        for (q3 = 0; q3 < evB.length; q3++) {
          var xB = mxx + 14 + (evB[q3].s / perBar) * (mW2 - 26);
          if (evB[q3].rest) { restGlyph(xB, topB, evB[q3].type); tieB.from = null; continue; }
          noteAt(evB[q3], xB, topB, false, false, memoB, tieB, sg);
        }
      }
      for (i = 0; i < 5; i++) { line(10, topM + i * SP, mx2, topM + i * SP, 0.9); line(10, topB + i * SP, mx2, topB + i * SP, 0.9); }
      if (isLast2) {
        line(mx2 - 4, topM, mx2 - 4, topB + SP * 4, 1);
        line(mx2, topM, mx2, topB + SP * 4, 3);
      }
    }
    add("</svg>");
    el.innerHTML = svg.join("");
    return;
  }
  add('<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H +
    '" data-sysh="' + SYS_H + '" data-sysn="' + nSys + '" style="background:#fbf8f1;border-radius:6px">');
  text(W / 2, 20, (song.title || "").replace(/&/g, "&amp;").replace(/</g, "&lt;"), 14, "middle", "bold");
  text(14, 20, (sc.ts && sc.ts[1] === 8 ? "♪ = " : "♩ = ") + sc.tempo, 11, "start");

  var tieFrom = null;     /* 小節や段をまたぐタイの始点 */
  for (var sy = 0; sy < nSys; sy++) {
    var top = 30 + sy * SYS_H + 46;
    /* 五線 */
    var staffEnd = W - 10;
    clef(16, top);
    var kx = 40, kw = keySig(kx, top);
    var startX = kx + kw + 8;
    if (sy === 0) { timeSig(startX + 6, top); startX += 20; }
    var ms = systems[sy].map(function (ix) { return sc.measures[ix]; });
    var needSum = 0;
    for (i = 0; i < systems[sy].length; i++) needSum += need[systems[sy][i]];
    var isLast = (sy === nSys - 1);
    /* 最後の段は詰めたまま、それ以外は段の幅いっぱいに広げる */
    var scaleW = isLast ? Math.min(1.35, (W - 10 - startX) / needSum) : (W - 10 - startX) / needSum;
    var mWs = systems[sy].map(function (ix) { return need[ix] * scaleW; });
    /* 段の頭に小節番号 */
    if (ms[0] && !ms[0].pickup) text(12, top - 12, String(ms[0].num), 9, "start", "normal", "#8a7f6c");   /* 弱起の段は番号を書かない */
    var mxAcc = startX;
    for (var mi = 0; mi < ms.length; mi++) {
      var M = ms[mi], mx = mxAcc, mW = mWs[mi];
      mxAcc += mW;
      /* 小節線 */
      line(mx + mW, top, mx + mW, top + SP * 4, 1);
      /* コードネーム */
      /* 各コードの拍に鳴っている音の x を探す（音の配置が決まってから） */
      var chordXs = [];
      var wsA = 0, wsT = 0, q4;
      for (q4 = 0; q4 < M.events.length; q4++) wsT += evWeight(M.events[q4]);
      var posX = [];
      var tsPad = M.ts ? 20 : 0;
      if (M.ts) timeSig(mx + 14, top, M.ts);
      for (q4 = 0; q4 < M.events.length; q4++) { posX.push(mx + 12 + tsPad + (wsA / Math.max(1, wsT)) * (mW - 22 - tsPad)); wsA += evWeight(M.events[q4]); }
      var lastEnd = -1;
      for (k = 0; k < M.chords.length; k++) {
        var cx = mx + 8, q5;
        for (q5 = 0; q5 < M.events.length; q5++) if (M.events[q5].s <= M.chords[k].pos + 0.01) cx = posX[q5] - 4;
        /* 前のコードネームと重ならないようにずらす */
        if (cx < lastEnd + 5) cx = lastEnd + 5;
        lastEnd = cx + M.chords[k].sym.length * 7.2;
        text(cx, top - 30, M.chords[k].sym.replace(/b/g, "♭").replace(/#/g, "♯"), 12, "start", "bold", "#5a3d1e",
          "-apple-system,Helvetica,sans-serif");
      }
      /* 音符 */
      var measAlt = {};
      var evs = M.events, xs = [], wsum = 0, wacc = 0;
      for (k = 0; k < evs.length; k++) wsum += evWeight(evs[k]);
      for (k = 0; k < evs.length; k++) {
        xs.push(mx + 12 + tsPad + (wacc / Math.max(1, wsum)) * (mW - 22 - tsPad));
        wacc += evWeight(evs[k]);
      }
      /* 連桁のまとまり（同じ拍の中の8分・16分） */
      var beamGroups = [], cur = null;
      for (k = 0; k < evs.length; k++) {
        var e = evs[k], beamable = !e.rest && (e.type === "eighth" || e.type === "16th");
        var beat = beamBeat(e.s);
        if (beamable && cur && cur.beat === beat) cur.idx.push(k);
        else { if (cur && cur.idx.length > 1) beamGroups.push(cur); cur = beamable ? { beat: beat, idx: [k] } : null; }
      }
      if (cur && cur.idx.length > 1) beamGroups.push(cur);
      var inBeam = {};
      for (k = 0; k < beamGroups.length; k++) for (i = 0; i < beamGroups[k].idx.length; i++) inBeam[beamGroups[k].idx[i]] = beamGroups[k];

      var stemEnd = {};
      for (k = 0; k < evs.length; k++) {
        var ev = evs[k], x = xs[k];
        if (ev.rest) { restGlyph(x, top, ev.type); tieFrom = null; continue; }
        var ps2 = posOf(ev.step, ev.oct), y = top + SP * 4 - ps2 * SP / 2;
        /* 加線 */
        var lp;
        for (lp = -2; lp >= ps2; lp -= 2) line(x - 7, top + SP * 4 - lp * SP / 2, x + 7, top + SP * 4 - lp * SP / 2, 1);
        for (lp = 10; lp <= ps2; lp += 2) line(x - 7, top + SP * 4 - lp * SP / 2, x + 7, top + SP * 4 - lp * SP / 2, 1);
        /* 臨時記号（調号と小節内の記憶を見て） */
        var want = ev.alter, keyA = keyAlt[ev.step] || 0, lk = ev.step + ev.oct;
        var curA = (lk in measAlt) ? measAlt[lk] : keyA;
        if (want !== curA && !ev.tieEnd) {
          text(x - 11, y + 4, want > 0 ? "♯" : (want < 0 ? "♭" : "♮"), 14, "middle");
          measAlt[lk] = want;
        }
        /* 符頭 */
        var hollow = (ev.type === "half" || ev.type === "whole");
        add('<ellipse cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" rx="4.9" ry="3.6" transform="rotate(-22 ' +
          x.toFixed(1) + ' ' + y.toFixed(1) + ')" fill="' + (hollow ? "#fbf8f1" : "#2a241c") + '" stroke="#2a241c" stroke-width="1.3"/>');
        /* 付点 */
        if (ev.dots) add('<circle cx="' + (x + 8) + '" cy="' + (y - (ps2 % 2 === 0 ? 3 : 0)) + '" r="1.5" fill="#2a241c"/>');
        /* 符幹 */
        if (ev.type !== "whole") {
          var grp = inBeam[k];
          var up;
          if (grp) {
            var sum = 0;
            for (i = 0; i < grp.idx.length; i++) {
              var eg = evs[grp.idx[i]]; sum += posOf(eg.step, eg.oct);
            }
            up = (sum / grp.idx.length) < 4;
          } else up = ps2 < 4;
          var sx = up ? x + 4.4 : x - 4.4, sy2 = up ? y - SP * 3.5 : y + SP * 3.5;
          stemEnd[k] = { x: sx, y: sy2, up: up };
          line(sx, y, sx, sy2, 1.2);
          if (song.yamtrem && !ev.rest) {                                                /* トレモロ記号：符幹に斜線3本 */
            var my = (y + sy2) / 2, sl;
            for (sl = 0; sl < 3; sl++) line(sx - 4.5, my + sl * 3.2 - 2.6 + 2.2, sx + 4.5, my + sl * 3.2 - 2.6 - 2.2, 1.6);
          }
          /* 旗（連桁でないとき） */
          if (!grp && (ev.type === "eighth" || ev.type === "16th")) {
            var nf = ev.type === "eighth" ? 1 : 2, f2;
            for (f2 = 0; f2 < nf; f2++) {
              var fy = sy2 + (up ? f2 * 6 : -f2 * 6);
              add('<path d="M' + sx + ',' + fy + ' q7,' + (up ? 5 : -5) + ' 5,' + (up ? 13 : -13) + '" fill="none" stroke="#2a241c" stroke-width="1.5"/>');
            }
          }
        }
        /* タイ */
        if (tieFrom && ev.tieEnd) {
          var tx0 = tieFrom.x, ty = y + 7;
          if (tieFrom.sys !== sy) tx0 = x - 22;
          add('<path d="M' + (tx0 + 4) + ',' + ty + ' Q' + ((tx0 + x) / 2) + ',' + (ty + 7) + ' ' + (x - 4) + ',' + ty + '" fill="none" stroke="#2a241c" stroke-width="1.1"/>');
        }
        tieFrom = ev.tieStart ? { x: x, sys: sy } : null;
      }
      /* 連桁 */
      for (k = 0; k < beamGroups.length; k++) {
        var gi = beamGroups[k].idx, a0 = stemEnd[gi[0]], a1 = stemEnd[gi[gi.length - 1]];
        if (!a0 || !a1) continue;
        var by = a0.up ? Math.min(a0.y, a1.y) : Math.max(a0.y, a1.y);
        /* 符幹の長さを連桁にそろえる */
        for (i = 0; i < gi.length; i++) {
          var se = stemEnd[gi[i]];
          if (se) line(se.x, se.y, se.x, by, 1.2);
        }
        add('<rect x="' + a0.x + '" y="' + (by - (a0.up ? 0 : 4)) + '" width="' + (a1.x - a0.x) + '" height="4" fill="#2a241c"/>');
        var has16 = gi.some(function (q2) { return evs[q2].type === "16th"; });
        if (has16) add('<rect x="' + a0.x + '" y="' + (by + (a0.up ? 6 : -10)) + '" width="' + (a1.x - a0.x) + '" height="3.5" fill="#2a241c"/>');
        if (gi.some(function (q2) { return evs[q2].trip; })) {
          var tripN = (gi.length >= 6 && evs[gi[0]].type === "16th") ? "6" : "3";
          text((a0.x + a1.x) / 2, by + (a0.up ? -4 : 14), tripN, 10, "middle", "bold");
        }
      }
      /* 連桁の無い3連（4分・2分の3連）：上にカギ括弧と「3」 */
      var run = [], runDur = 0;
      var flushRun = function () {
        if (run.length >= 2) {
          var x0 = xs[run[0]] - 3, x1 = xs[run[run.length - 1]] + 8, yb = top - 10, q7;
          for (q7 = 0; q7 < run.length; q7++) { var se2 = stemEnd[run[q7]]; if (se2 && se2.up) yb = Math.min(yb, se2.y - 6); }
          line(x0, yb, x1, yb, 0.9); line(x0, yb, x0, yb + 4, 0.9); line(x1, yb, x1, yb + 4, 0.9);
          add('<rect x="' + ((x0 + x1) / 2 - 5) + '" y="' + (yb - 5) + '" width="10" height="10" fill="#fbf6ea"/>');
          text((x0 + x1) / 2, yb + 3.5, "3", 10, "middle", "bold");
        }
        run = []; runDur = 0;
      };
      for (k = 0; k < evs.length; k++) {
        var et = evs[k];
        if (et.trip && (et.type === "quarter" || et.type === "half") && !inBeam[k]) {
          run.push(k); runDur += et.dur;
          if (runDur >= (et.type === "quarter" ? 24 : 48)) flushRun();
        } else flushRun();
      }
      flushRun();
    }
    /* 五線は小節の終わりまで引く（最後の段が短いときに余らない） */
    for (i = 0; i < 5; i++) line(10, top + i * SP, mxAcc, top + i * SP, 0.9);
    /* 最後の段は終止線 */
    if (sy === nSys - 1) {
      var ex = mxAcc;
      line(ex - 4, top, ex - 4, top + SP * 4, 1);
      line(ex, top, ex, top + SP * 4, 3);
    }
  }
  add("</svg>");
  el.innerHTML = svg.join("");
}

/* 譜面を PDF に（外部ライブラリなし）。SVG を画像にして、段の切れ目で A4 縦のページに分け、JPEG として PDF に埋め込む */
function scorePdf(song, HH, done, opts) {
  var land = !!(opts && opts.landscape);
  try {
    if (typeof document === "undefined" || !song || !song.sheet) { done(null); return; }
    var tmp = document.createElement("div");
    tmp.setAttribute("data-w", land ? "1250" : "900");                         /* 横向きは段を広く（1段に入る小節が増える） */
    drawScore(tmp, song, HH);
    var html = tmp.innerHTML, m = html.match(/<svg[^>]*>/);
    if (!m) { done(null); return; }
    var wM = html.match(/ width="(\d+)"/), hM = html.match(/ height="(\d+)"/), sh = html.match(/data-sysh="([\d.]+)"/), sn = html.match(/data-sysn="(\d+)"/);
    var W = wM ? parseInt(wM[1], 10) : 900, H = hM ? parseInt(hM[1], 10) : 1200;
    var SYSH = sh ? parseFloat(sh[1]) : 160, NS = sn ? parseInt(sn[1], 10) : 1;
    var img = new Image();
    img.onload = function () {
      try {
        var SC = 2, PW = land ? 842 : 595, PH = land ? 595 : 842, MG = 20, drawW = PW - MG * 2, k = drawW / W;
        var HEADH = 64 + 14 * ((opts && opts.extra) ? opts.extra.length : 0);          /* ページ上部の見出し帯（SVG 単位。推定したキー・和音の行ぶん増える） */
        var perPage = Math.max(1, Math.floor(((PH - MG * 2) / k - HEADH - 8) / SYSH));      /* 1ページに入る段数 */
        var nPages = Math.ceil(NS / perPage);
        var head = pdfHeader(song, HH, opts && opts.extra);
        var pages = [], idx = 0, y0 = 28, pgNo = 0;
        while (idx < NS) {
          var n = Math.min(perPage, NS - idx), y1 = (idx + n >= NS) ? H : 30 + (idx + n) * SYSH;
          var cv = document.createElement("canvas");
          cv.width = Math.round(W * SC); cv.height = Math.round((y1 - y0 + HEADH) * SC);
          var g = cv.getContext("2d");
          g.fillStyle = "#fbf8f1"; g.fillRect(0, 0, cv.width, cv.height);
          g.drawImage(img, 0, y0, W, y1 - y0, 0, HEADH * SC, cv.width, (y1 - y0) * SC);              /* 元の SVG の座標で切り出す（画像の大きさは 1倍） */
          g.save(); g.scale(SC, SC);                                                  /* 見出し：題名・テンポ・キー・形式・低音の型・ページ */
          g.fillStyle = "#2a241c"; g.textBaseline = "alphabetic";
          g.font = "bold 20px Georgia,'Hiragino Mincho ProN','Yu Mincho',serif"; g.textAlign = "left";
          g.fillText(head.title, 16, 26);
          g.font = "12px -apple-system,'Hiragino Sans','Yu Gothic',sans-serif"; g.fillStyle = "#5a4d3a";
          head.lines.forEach(function (ln, li) { g.fillText(ln, 16, 42 + li * 14); });
          g.textAlign = "right"; g.fillText((pgNo + 1) + " / " + nPages, W - 16, 26);
          g.strokeStyle = "#b09a6a"; g.lineWidth = 1; g.beginPath(); g.moveTo(16, HEADH - 1); g.lineTo(W - 16, HEADH - 1); g.stroke();
          g.restore(); pgNo++;
          var b64 = cv.toDataURL("image/jpeg", 0.92).split(",")[1], bin = atob(b64), bytes = new Uint8Array(bin.length), z;
          for (z = 0; z < bin.length; z++) bytes[z] = bin.charCodeAt(z);
          pages.push({ jpg: bytes, w: cv.width, h: cv.height });
          idx += n; y0 = y1;
        }
        done(makePdf(pages, PW, PH, MG));
      } catch (er) { done(null); }
    };
    img.onerror = function () { done(null); };
    var svgText = html.slice(html.indexOf("<svg"));
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgText);
  } catch (e2) { done(null); }
}
/* ---------- 音符エディタ（ピアノロール）----------
   host に SVG を作る。音符：ドラッグで移動（時間は 1/4 拍、高さは半音）、右端で長さ、ダブルクリック（タップ2回）で追加、
   Delete／Backspace で削除、矢印キーで微調整。cfg: { notes:[{t,d,p,v,c}], bars, bpb, chords:[{at,b,sym}], onChange(notes), audition(p) } */
function noteEditor(host, cfg) {
  var NS = "http://www.w3.org/2000/svg", LEFT = 36, TOP = 40, ROW = 12, ppb = 40, SNAP = 0.25;
  var notes = (cfg.notes || []).map(function (n, i) { return { id: i + 1, t: n.t, d: n.d, p: n.p, v: n.v || 82, c: n.c, ly: n.ly }; }), nextId = notes.length + 2;
  var sel = null, undo = [], bpb = cfg.bpb || 4, meters = mtrNorm(cfg.meters, bpb);
  var minP = 60, maxP = 72;
  notes.forEach(function (n) { if (n.p < minP) minP = n.p; if (n.p > maxP) maxP = n.p; });
  var lo = Math.max(24, Math.floor((minP - 5) / 12) * 12), hi = Math.min(108, Math.ceil((maxP + 5) / 12) * 12 + 11);
  var lastD = 1;
  host.innerHTML = "";
  host.style.position = "relative";
  var bar = document.createElement("div");
  bar.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:4px 0;font-size:13px";
  function mk(label, fn) { var b = document.createElement("button"); b.type = "button"; b.className = "mini"; b.textContent = label; b.onclick = fn; bar.appendChild(b); return b; }
  var info = document.createElement("span");
  info.style.cssText = "color:var(--dim,#a4967f);font-size:12px";
  var wrap = document.createElement("div");
  wrap.style.cssText = "overflow:auto;max-height:340px;border:1px solid var(--line,#3b3125);border-radius:6px;background:#120f0b;outline:none";
  wrap.tabIndex = 0;
  var svg = document.createElementNS(NS, "svg");
  svg.style.cssText = "display:block;touch-action:none;user-select:none";
  wrap.appendChild(svg);
  host.appendChild(bar); host.appendChild(wrap);
  function totalBeats() {
    var m = mtrStart(meters, Math.max(cfg.bars || 8, meters[meters.length - 1].bar));
    notes.forEach(function (n) { if (n.t + n.d > m) m = mtrStart(meters, mtrBarOf(meters, n.t + n.d - 1e-6).bar + 1); });
    return m;
  }
  function X(t) { return LEFT + t * ppb; }
  function Y(p) { return TOP + (hi - p) * ROW; }
  function el(name, attrs, parent) { var e2 = document.createElementNS(NS, name); for (var k in attrs) e2.setAttribute(k, attrs[k]); (parent || svg).appendChild(e2); return e2; }
  var BLACK = { 1: 1, 3: 1, 6: 1, 8: 1, 10: 1 }, NM = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  function emit() { if (cfg.onChange) cfg.onChange(snapshot()); }
  function snapshot() { return notes.map(function (n) { return { t: n.t, d: n.d, p: n.p, v: n.v, c: n.c, ly: n.ly }; }).sort(function (a, b) { return a.t - b.t || a.p - b.p; }); }
  function pushUndo() { undo.push(JSON.stringify(notes)); if (undo.length > 30) undo.shift(); }
  function render() {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var TB = totalBeats(), W = LEFT + TB * ppb + 20, H2 = TOP + (hi - lo + 1) * ROW + 8, p, t;
    svg.setAttribute("width", W); svg.setAttribute("height", H2);
    for (p = lo; p <= hi; p++) {
      el("rect", { x: LEFT, y: Y(p), width: TB * ppb, height: ROW, fill: BLACK[p % 12] ? "#1a1510" : "#16120d" });
      el("line", { x1: LEFT, x2: LEFT + TB * ppb, y1: Y(p) + ROW, y2: Y(p) + ROW, stroke: p % 12 === 0 ? "#4a3d2c" : "#241d15", "stroke-width": 1 });
      if (p % 12 === 0) { var tx = el("text", { x: 4, y: Y(p) + ROW - 2, fill: "#a4967f", "font-size": 10 }); tx.textContent = "C" + (p / 12 - 1); }
    }
    var bs = {}, bb = 0;
    while (mtrStart(meters, bb) <= TB + 1e-6 && bb < 5000) {
      var s0 = mtrStart(meters, bb); bs[Math.round(s0 * 1000)] = 1;
      el("line", { x1: X(s0), x2: X(s0), y1: TOP, y2: H2 - 8, stroke: "#6a5a40", "stroke-width": 1.4 });
      var bn = el("text", { x: X(s0) + 3, y: 12, fill: "#a4967f", "font-size": 10 }); bn.textContent = bb + 1;
      if (meters.some(function (m) { return m.bar - 1 === bb; }) && (bb > 0 || meters.length > 1 || bpb !== 4)) {
        var mm = null; meters.forEach(function (m) { if (m.bar - 1 <= bb) mm = m; });
        var sg2 = mtrSig(mm), sx2 = el("text", { x: X(s0) + 18, y: 12, fill: "#d9a441", "font-size": 10, "font-weight": "bold" }); sx2.textContent = sg2[0] + "/" + sg2[1];
      }
      bb++;
    }
    for (t = 0; t <= TB; t += 1) {
      if (bs[Math.round(t * 1000)]) continue;
      el("line", { x1: X(t), x2: X(t), y1: TOP, y2: H2 - 8, stroke: "#2a2218", "stroke-width": 1 });
    }
    (cfg.chords || []).forEach(function (c2) {
      var ct = el("text", { x: X(c2.at) + 3, y: 32, fill: "#d9a441", "font-size": 12, "font-weight": "bold" }); ct.textContent = c2.sym;
    });
    notes.forEach(function (n) {
      var low = (n.c != null && n.c < 0.7), s = (n.id === sel);
      var r = el("rect", { x: X(n.t), y: Y(n.p) + 1, width: Math.max(4, n.d * ppb - 1), height: ROW - 2, rx: 2,
        fill: s ? "#f0c674" : (low ? "#c0562f" : "#7fa88a"), stroke: s ? "#fff" : "#0c0a07", "stroke-width": s ? 1.5 : 1, "data-id": n.id, style: "cursor:grab" });
      r.addEventListener("pointerdown", function (ev) { startDrag(ev, n); });
    });
    info.textContent = notes.length + "音" + (sel ? "（選択中：" + NM[sel_p() % 12] + (Math.floor(sel_p() / 12) - 1) + "）" : "") + "　ドラッグで移動／右端で長さ／ダブルクリックで追加／Delete で削除";
  }
  function sel_p() { var n = byId(sel); return n ? n.p : 60; }
  function byId(id) { for (var i = 0; i < notes.length; i++) if (notes[i].id === id) return notes[i]; return null; }
  function snapT(v) { return Math.max(0, Math.round(v / SNAP) * SNAP); }
  function local(ev) { var r = svg.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; }
  function startDrag(ev, n) {
    ev.preventDefault(); ev.stopPropagation();
    sel = n.id; wrap.focus();
    var pt = local(ev), edge = (pt.x > X(n.t + n.d) - 7), o = { t: n.t, d: n.d, p: n.p }, moved = false;
    if (cfg.audition) cfg.audition(n.p);
    pushUndo();
    function mv(e2) {
      var q = local(e2), dx = (q.x - pt.x) / ppb, dy = Math.round((q.y - pt.y) / ROW);
      if (edge) n.d = Math.max(SNAP, snapT(o.d + dx)); else { n.t = snapT(o.t + dx); n.p = Math.max(lo, Math.min(hi, o.p - dy)); }
      if (Math.abs(q.x - pt.x) + Math.abs(q.y - pt.y) > 3) moved = true;
      render();
    }
    function up() {
      window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up);
      if (!moved) undo.pop(); else { if (cfg.audition && n.p !== o.p) cfg.audition(n.p); emit(); }
      render();
    }
    window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up);
    render();
  }
  svg.addEventListener("dblclick", function (ev) {
    var q = local(ev), t = snapT((q.x - LEFT) / ppb), p = hi - Math.floor((q.y - TOP) / ROW);
    if (q.x < LEFT || q.y < TOP || p < lo || p > hi) return;
    pushUndo();
    var n = { id: nextId++, t: t, d: lastD, p: p, v: 82, c: 1 };
    notes.push(n); sel = n.id;
    if (cfg.audition) cfg.audition(p);
    render(); emit();
  });
  svg.addEventListener("pointerdown", function (ev) { if (ev.target === svg || ev.target.tagName === "rect" && !ev.target.getAttribute("data-id") || ev.target.tagName === "line" || ev.target.tagName === "text") { sel = null; render(); } });
  function del() { if (sel == null) return; pushUndo(); notes = notes.filter(function (n) { return n.id !== sel; }); sel = null; render(); emit(); }
  function nudge(dt, dp) {
    var n = byId(sel); if (!n) return;
    pushUndo();
    n.t = Math.max(0, n.t + dt); n.p = Math.max(lo, Math.min(hi, n.p + dp));
    if (dp && cfg.audition) cfg.audition(n.p);
    render(); emit();
  }
  wrap.addEventListener("keydown", function (ev) {
    var k = ev.key;
    if (k === "Delete" || k === "Backspace") { ev.preventDefault(); del(); }
    else if (k === "ArrowLeft") { ev.preventDefault(); nudge(-SNAP, 0); }
    else if (k === "ArrowRight") { ev.preventDefault(); nudge(SNAP, 0); }
    else if (k === "ArrowUp") { ev.preventDefault(); nudge(0, 1); }
    else if (k === "ArrowDown") { ev.preventDefault(); nudge(0, -1); }
  });
  mk("選んだ音を削除", del);
  mk("半音上", function () { nudge(0, 1); });
  mk("半音下", function () { nudge(0, -1); });
  mk("オクターヴ上", function () { nudge(0, 12); });
  mk("オクターヴ下", function () { nudge(0, -12); });
  mk("元に戻す", function () { var s2 = undo.pop(); if (s2) { notes = JSON.parse(s2); sel = null; render(); emit(); } });
  mk("拡大", function () { ppb = Math.min(120, ppb + 12); render(); });
  mk("縮小", function () { ppb = Math.max(16, ppb - 12); render(); });
  bar.appendChild(info);
  render();
  return {
    getNotes: snapshot,
    setNotes: function (arr, ms) { notes = arr.map(function (n, i) { return { id: nextId++, t: n.t, d: n.d, p: n.p, v: n.v || 82, c: n.c, ly: n.ly }; }); if (ms) meters = mtrNorm(ms, bpb); sel = null; undo = []; render(); },
    destroy: function () { host.innerHTML = ""; }
  };
}
/* ---------- 拍子の地図（編集画面用）----------
   meters＝[{ bar: 1始まり, bpb: 1小節の4分音符の数, sig:[分子,分母] }]。先頭は必ず bar:1 */
function mtrNorm(ms, bpb0) {
  var m = (ms || []).filter(function (x) { return x && x.bar >= 1 && x.bpb > 0; }).map(function (x) { return { bar: Math.round(x.bar), bpb: x.bpb, sig: x.sig }; });
  m.sort(function (a, b) { return a.bar - b.bar; });
  if (!m.length || m[0].bar !== 1) m.unshift({ bar: 1, bpb: bpb0 || 4 });
  var out = [];
  m.forEach(function (x) { var l = out[out.length - 1]; if (l && l.bar === x.bar) out[out.length - 1] = x; else if (!l || l.bpb !== x.bpb || (x.sig && l.sig && (x.sig[0] !== l.sig[0] || x.sig[1] !== l.sig[1]))) out.push(x); });
  return out;
}
function mtrLen(ms, b0) { var v = ms[0].bpb, i; for (i = 0; i < ms.length; i++) if (ms[i].bar - 1 <= b0) v = ms[i].bpb; return v; }
function mtrStart(ms, b0) { var t = 0, b; for (b = 0; b < b0; b++) t += mtrLen(ms, b); return t; }
function mtrBarOf(ms, t) {
  var b = 0, s = 0, g = 0;
  while (g++ < 20000) { var L = mtrLen(ms, b); if (t < s + L - 1e-9) return { bar: b, beat: Math.max(0, t - s) }; s += L; b++; }
  return { bar: b, beat: 0 };
}
function mtrSig(m) { return m.sig ? m.sig : (m.bpb % 1 === 0 ? [m.bpb, 4] : [m.bpb * 2, 8]); }
function mtrRemap(oldM, newM, t) { var q = mtrBarOf(oldM, t + 1e-9); return mtrStart(newM, q.bar) + q.beat; }
/* ---------- 五線譜の音符エディタ ----------
   旋律を五線譜（ト音記号・調号つき）に表示し、音符を直接動かす。上下のドラッグ＝線・間ごとに動く（調号に従う）、左右＝刻みごと（1/4拍・または3連の1/3拍）、
   ボタンで音価（全・2分・付点4分・4分・付点8分・8分・16分・3連符）、♯・♭・♮、削除。空いた所をダブルクリックで追加。
   表示：休符（音の無い所）、連桁（同じ拍の8分・16分）、タイ（小節・段をまたぐ音符は分けてタイでつなぐ）、3連符（括弧と「3」）、拍子記号（途中の変化も）。
   cfg: { notes, bars, bpb, meters, fifths, chords:[{at,b,sym}], onChange(notes, meters), audition(p) } */
function staffEditor(host, cfg) {
  var NS = "http://www.w3.org/2000/svg", bpb0 = cfg.bpb || 4, fifths = cfg.fifths || 0, ppb = 46, SNAP = 0.25, STEP = 4;
  var notes = (cfg.notes || []).map(function (n, i) { return { id: i + 1, t: n.t, d: n.d, p: n.p, v: n.v || 82, c: n.c, ly: n.ly }; }), nextId = notes.length + 2;
  var grand = !!cfg.grand;                          /* 大譜表（ト音記号＋ヘ音記号）：C4 より低い音は下の段へ */
  var meters = mtrNorm(cfg.meters, bpb0), chords = (cfg.chords || []).map(function (c) { return { at: c.at, b: c.b, sym: c.sym }; });
  var sel = null, undo = [], lastD = 1;
  var LET = ["C", "D", "E", "F", "G", "A", "B"], NAT = [0, 2, 4, 5, 7, 9, 11];
  var SH = ["F", "C", "G", "D", "A", "E", "B"], FL = ["B", "E", "A", "D", "G", "C", "F"], keyAlt = {};
  var i0;
  if (fifths > 0) for (i0 = 0; i0 < fifths && i0 < 7; i0++) keyAlt[SH[i0]] = 1;
  if (fifths < 0) for (i0 = 0; i0 < -fifths && i0 < 7; i0++) keyAlt[FL[i0]] = -1;
  var SP_S = [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [3, 0], [3, 1], [4, 0], [4, 1], [5, 0], [5, 1], [6, 0]];
  var SP_F = [[0, 0], [1, -1], [1, 0], [2, -1], [2, 0], [3, 0], [4, -1], [4, 0], [5, -1], [5, 0], [6, -1], [6, 0]];
  function spell(p) {
    var pc = ((p % 12) + 12) % 12, oct = Math.floor(p / 12) - 1, tb = (fifths < 0 ? SP_F : SP_S)[pc];
    return { li: tb[0], alter: tb[1], oct: oct };
  }
  function posOf(p) { var s = spell(p); return s.oct * 7 + s.li - 30; }              /* E4（下の線）＝0 */
  function pitchAt(pos) {
    var tot = pos + 30, oct = Math.floor(tot / 7), li = ((tot % 7) + 7) % 7;
    return (oct + 1) * 12 + NAT[li] + (keyAlt[LET[li]] || 0);
  }
  function blen(b) { return mtrLen(meters, b); }
  function bstart(b) { return mtrStart(meters, b); }
  function barOf(t) { return mtrBarOf(meters, t + 1e-9); }
  host.innerHTML = "";
  var bar = document.createElement("div");
  bar.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:4px 0;font-size:13px";
  function mk(label, fn) { var b = document.createElement("button"); b.type = "button"; b.className = "mini"; b.textContent = label; b.onclick = fn; bar.appendChild(b); return b; }
  var info = document.createElement("span");
  info.style.cssText = "color:var(--dim,#a4967f);font-size:12px";
  var wrap = document.createElement("div");
  wrap.style.cssText = "overflow:auto;max-height:420px;border:1px solid var(--line,#3b3125);border-radius:6px;background:#fbf8f1;outline:none";
  wrap.tabIndex = 0;
  var svg = document.createElementNS(NS, "svg");
  svg.style.cssText = "display:block;touch-action:none;user-select:none";
  wrap.appendChild(svg);
  host.appendChild(bar); host.appendChild(wrap);
  function el(name, attrs, parent) { var x = document.createElementNS(NS, name); for (var k in attrs) x.setAttribute(k, attrs[k]); (parent || svg).appendChild(x); return x; }
  function byId(id) { for (var i = 0; i < notes.length; i++) if (notes[i].id === id) return notes[i]; return null; }
  function snapshot() { return notes.map(function (n) { return { t: n.t, d: n.d, p: n.p, v: n.v, c: n.c, ly: n.ly }; }).sort(function (a, b) { return a.t - b.t || a.p - b.p; }); }
  function metersOut() { return meters.map(function (m) { return { bar: m.bar, bpb: m.bpb, sig: m.sig ? m.sig.slice() : undefined }; }); }
  function emit() { if (cfg.onChange) cfg.onChange(snapshot(), metersOut()); }
  function pushUndo() { undo.push(JSON.stringify({ n: notes, m: meters, c: chords })); if (undo.length > 30) undo.shift(); }
  function popUndo() {
    var s2 = undo.pop(); if (!s2) return;
    var o = JSON.parse(s2); notes = o.n; meters = o.m; chords = o.c; sel = null; render(); emit();
  }
  var L = null;
  function layout() {
    var availW = Math.max(360, (host.clientWidth || 760) - 24), HEAD = 70, nb = Math.max(cfg.bars || 8, meters[meters.length - 1].bar), mx = 0, b;
    notes.forEach(function (n) { if (n.t + n.d > mx) mx = n.t + n.d; });
    if (mx > 0) nb = Math.max(nb, barOf(mx - 1e-6).bar + 1);
    var bars = [], row = 0, x = HEAD, maxX = HEAD;
    for (b = 0; b < nb; b++) {
      var len = blen(b), changed = (b === 0) || meters.some(function (m) { return m.bar - 1 === b; }), pad = changed ? 18 : 0, w = len * ppb + 16 + pad;
      if (x + w > availW && x > HEAD) { row++; x = HEAD; }
      bars.push({ b: b, len: len, row: row, x: x, pad: pad, w: w, changed: changed });
      x += w; if (x > maxX) maxX = x;
    }
    return { HEAD: HEAD, nb: nb, bars: bars, rows: row + 1, SH: grand ? 262 : 150, W: Math.max(360, maxX + 12) };
  }
  L = layout();
  function pt(t) {                                  /* 拍の位置 → 段・x */
    var q = barOf(t), bi = L.bars[Math.min(q.bar, L.bars.length - 1)];
    return { row: bi.row, x: bi.x + bi.pad + 8 + q.beat * ppb, bar: q.bar };
  }
  function yb(row) { return row * L.SH + 100; }     /* 下の線の y（ト音記号の段） */
  function ybB(row) { return yb(row) + 108; }       /* ヘ音記号の段の下の線 */
  function staffOf(n) { return grand && n.p < 60 ? 1 : 0; }
  function ySt(st, row) { return st ? ybB(row) : yb(row); }
  function triOf(d) {                               /* 3連符：1/6・1/3・2/3・4/3 拍 */
    var T = [[1 / 6, 0.25], [1 / 3, 0.5], [2 / 3, 1], [4 / 3, 2]], i;
    for (i = 0; i < T.length; i++) if (Math.abs(d - T[i][0]) < 0.02) return { v: T[i][1], dot: false, tri: true, unit: T[i][0] * 3 };
    return null;
  }
  function kind(d) {                                /* 音価の見た目：{ v: 4|2|1|0.5|0.25, dot, tri } */
    var tr = triOf(d); if (tr) return tr;
    if (d >= 3.5) return { v: 4, dot: false };
    if (d >= 2.6) return { v: 2, dot: true };
    if (d >= 1.75) return { v: 2, dot: false };
    if (d >= 1.25) return { v: 1, dot: true };
    if (d >= 0.875) return { v: 1, dot: false };
    if (d >= 0.625) return { v: 0.5, dot: true };
    if (d >= 0.4375) return { v: 0.5, dot: false };
    return { v: 0.25, dot: false };
  }
  function segsOf(n) {                              /* 小節をまたぐ音符を、小節ごとに分ける */
    var out = [], t = n.t, end = n.t + n.d, guard = 0;
    while (t < end - 1e-6 && guard++ < 64) {
      var q = barOf(t), be = bstart(q.bar + 1), e2 = Math.min(end, be);
      out.push({ n: n, t0: t, d0: e2 - t, first: out.length === 0, last: e2 >= end - 1e-6 });
      t = e2;
    }
    return out;
  }
  /* 連桁のまとまり：4分の拍子は1拍ごと。分母8（6/8・9/8・12/8＝3つずつ、7/8＝2+2+3、5/8＝3+2、それ以外＝2つずつ）は8分の並びで */
  var UNIT = cfg.unit || 1;
  function beamGroup(bar0, beat) {
    var mm = null; meters.forEach(function (m) { if (m.bar - 1 <= bar0) mm = m; });
    var sg = mm ? mtrSig(mm) : [4, 4], qb = beat * UNIT;
    if (sg[1] !== 8) return Math.floor(qb + 1e-6);
    var e8 = qb * 2 + 1e-6, n = sg[0], pat;
    if (n % 3 === 0) pat = null; else if (n === 7) pat = [2, 2, 3]; else if (n === 5) pat = [3, 2]; else pat = null;
    if (!pat) { var gsz = (n % 3 === 0) ? 3 : 2; return Math.floor(e8 / gsz); }
    var acc = 0, z;
    for (z = 0; z < pat.length; z++) { acc += pat[z]; if (e8 < acc) return z; }
    return pat.length;
  }
  function sigText(m) { var s = mtrSig(m); return [String(s[0]), String(s[1])]; }
  function drawRest(vv, xr, y) {
    var f;
    if (vv >= 4) el("rect", { x: xr - 5, y: y - 24, width: 10, height: 4, fill: "#8a7f6c" });
    else if (vv >= 2) el("rect", { x: xr - 5, y: y - 20, width: 10, height: 4, fill: "#8a7f6c" });
    else if (vv >= 1) el("path", { d: "M" + (xr - 2) + "," + (y - 28) + " l5,6 l-5,5 l5,6 c-6,-2 -7,3 -2,7", fill: "none", stroke: "#8a7f6c", "stroke-width": 2 });
    else { for (f = 0; f < (vv <= 0.25 ? 2 : 1); f++) { el("circle", { cx: xr - 1 - f * 1.5, cy: y - 22 + f * 6, r: 2, fill: "#8a7f6c" }); } el("line", { x1: xr + 2, y1: y - 26, x2: xr - 2 - (vv <= 0.25 ? 1.5 : 0), y2: y - 14 + (vv <= 0.25 ? 6 : 0), stroke: "#8a7f6c", "stroke-width": 1.3 }); }
  }
  function render() {
    L = layout();
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.setAttribute("width", L.W); svg.setAttribute("height", L.rows * L.SH + 20);
    var r, c, k, f, kn = Math.abs(fifths), kpos = fifths > 0 ? [8, 5, 9, 6, 3, 7, 4] : [4, 7, 3, 6, 2, 5, 1];
    for (r = 0; r < L.rows; r++) {
      var y0 = yb(r);
      for (k = 0; k < 5; k++) el("line", { x1: 10, x2: L.W - 12, y1: y0 - k * 8, y2: y0 - k * 8, stroke: "#2a241c", "stroke-width": 0.9 });
      var cl = el("text", { x: 14, y: y0 - 6, "font-size": 40, fill: "#2a241c", "font-family": "Georgia,serif" }); cl.textContent = "𝄞";
      for (k = 0; k < kn && k < 7; k++) { var ka = el("text", { x: 44 + k * 7, y: y0 - kpos[k] * 4 + 4, "font-size": 14, fill: "#2a241c" }); ka.textContent = fifths > 0 ? "♯" : "♭"; }
      if (grand) {
        var yB = ybB(r);
        for (k = 0; k < 5; k++) el("line", { x1: 10, x2: L.W - 12, y1: yB - k * 8, y2: yB - k * 8, stroke: "#2a241c", "stroke-width": 0.9 });
        var cl2 = el("text", { x: 14, y: yB - 8, "font-size": 34, fill: "#2a241c", "font-family": "Georgia,serif" }); cl2.textContent = "𝄢";
        for (k = 0; k < kn && k < 7; k++) { var kb = el("text", { x: 44 + k * 7, y: yB - (kpos[k] - 2) * 4 + 4, "font-size": 14, fill: "#2a241c" }); kb.textContent = fifths > 0 ? "♯" : "♭"; }
        el("line", { x1: 10, x2: 10, y1: y0 - 32, y2: yB, stroke: "#2a241c", "stroke-width": 1.5 });
      }
    }
    var firstOfRow = {};
    L.bars.forEach(function (bi) {
      var y0 = yb(bi.row);
      var yBot = grand ? ybB(bi.row) : y0;
      el("line", { x1: bi.x, x2: bi.x, y1: y0 - 32, y2: yBot, stroke: "#2a241c", "stroke-width": 1 });
      el("line", { x1: bi.x + bi.w, x2: bi.x + bi.w, y1: y0 - 32, y2: yBot, stroke: "#2a241c", "stroke-width": 1 });
      if (firstOfRow[bi.row] == null) { firstOfRow[bi.row] = 1; var bnum = el("text", { x: bi.x + 3, y: y0 - 38, "font-size": 10, fill: "#8a7f6c" }); bnum.textContent = bi.b + 1; }
      if (bi.changed) {                              /* 拍子記号 */
        var mm = null; meters.forEach(function (m) { if (m.bar - 1 <= bi.b) mm = m; });
        var tx = sigText(mm);
        var a1 = el("text", { x: bi.x + 4, y: y0 - 18, "font-size": 17, "font-weight": "bold", fill: "#2a241c", "font-family": "Georgia,serif" }); a1.textContent = tx[0];
        var a2 = el("text", { x: bi.x + 4, y: y0 - 2, "font-size": 17, "font-weight": "bold", fill: "#2a241c", "font-family": "Georgia,serif" }); a2.textContent = tx[1];
        if (grand) {
          var b1 = el("text", { x: bi.x + 4, y: yBot - 18, "font-size": 17, "font-weight": "bold", fill: "#2a241c", "font-family": "Georgia,serif" }); b1.textContent = tx[0];
          var b2 = el("text", { x: bi.x + 4, y: yBot - 2, "font-size": 17, "font-weight": "bold", fill: "#2a241c", "font-family": "Georgia,serif" }); b2.textContent = tx[1];
        }
      }
    });
    chords.forEach(function (cc) {
      var q = pt(cc.at), ct = el("text", { x: q.x - 2, y: yb(q.row) - 52, "font-size": 12, "font-weight": "bold", fill: "#5a3d1e" }); ct.textContent = cc.sym;
    });
    /* 小節ごとの音符の断片（セグメント） */
    var segs = [], segsOfBar = {};
    notes.forEach(function (n) { segsOf(n).forEach(function (sg) { segs.push(sg); var bi = barOf(sg.t0).bar; (segsOfBar[bi] = segsOfBar[bi] || []).push(sg); }); });
    /* 休符：小節の中の、音の無い所 */
    var bi2, stI, nStaff = grand ? 2 : 1;
    for (stI = 0; stI < nStaff; stI++) for (bi2 = 0; bi2 < L.nb; bi2++) {
      var list = (segsOfBar[bi2] || []).filter(function (sg0) { return staffOf(sg0.n) === stI; }).sort(function (a, b) { return a.t0 - b.t0; }), bst = bstart(bi2), bl = blen(bi2), cur = bst, endB = bst + bl;
      list.concat([{ t0: endB, d0: 0 }]).forEach(function (sg) {
        var gap = sg.t0 - cur, guard = 0;
        while (gap > 0.24 && guard++ < 40) {
          var vv, used;
          if (Math.abs(gap - 2 / 3) < 0.03) { vv = 1; used = gap; }
          else if (Math.abs(gap - 1 / 3) < 0.03) { vv = 0.5; used = gap; }
          else {
            vv = [4, 2, 1, 0.5, 0.25].filter(function (x) { return x <= gap + 1e-6; })[0] || 0.25;
            if (vv === 4 && bl !== 4) vv = 2;
            if (gap >= bl - 1e-6) vv = bl >= 4 ? 4 : 2;
            used = vv;
          }
          var q = pt(cur), y = ySt(stI, q.row), xr = q.x + 6;
          drawRest(vv, xr, y);
          cur += used; gap -= used;
        }
        cur = Math.max(cur, sg.t0 + sg.d0);
      });
    }
    /* 連桁：同じ拍にある8分・16分の音符（2つ以上） */
    var beamed = {}, bkeys = {};
    segs.forEach(function (sg) {
      if (kind(sg.d0).v > 0.5) return;
      var q = barOf(sg.t0), key = staffOf(sg.n) + "/" + q.bar + ":" + beamGroup(q.bar, q.beat);
      (bkeys[key] = bkeys[key] || []).push(sg);
    });
    Object.keys(bkeys).forEach(function (kk) { if (bkeys[kk].length >= 2) bkeys[kk].forEach(function (sg) { sg.beam = kk; beamed[kk] = bkeys[kk]; }); });
    /* 音符 */
    var heads = [];
    segs.forEach(function (sg) {
      var n = sg.n, q = pt(sg.t0), stN = staffOf(n), pos = posOf(n.p) + (stN ? 12 : 0), yBase = ySt(stN, q.row), y = yBase - pos * STEP, x = q.x, s = spell(n.p), s2 = (n.id === sel), kd = kind(sg.d0);
      var col = s2 ? "#c0562f" : ((n.c != null && n.c < 0.7) ? "#d98c2f" : "#2a241c");
      sg.x = x; sg.y = y; sg.row = q.row; sg.pos = pos; sg.col = col; sg.kd = kd; sg.bar = q.bar;
      var lp;
      for (lp = -2; lp >= pos; lp -= 2) el("line", { x1: x - 8, x2: x + 8, y1: yBase - lp * STEP, y2: yBase - lp * STEP, stroke: "#2a241c", "stroke-width": 1 });
      for (lp = 10; lp <= pos; lp += 2) el("line", { x1: x - 8, x2: x + 8, y1: yBase - lp * STEP, y2: yBase - lp * STEP, stroke: "#2a241c", "stroke-width": 1 });
      if (n.ly && sg.first) { var lt = el("text", { x: x - 4, y: (grand ? ybB(q.row) : yb(q.row)) + 28, "font-size": 12, fill: s2 ? "#c0562f" : "#3a5a8a" }); lt.textContent = n.ly; }
      el("line", { x1: x, x2: Math.max(x + 6, x + sg.d0 * ppb - 3), y1: y + 7, y2: y + 7, stroke: s2 ? "#c0562f" : "#b9ac8a", "stroke-width": 2 });   /* 長さの目安 */
      var kalt = keyAlt[LET[s.li]] || 0;
      if (sg.first && s.alter !== kalt) { var ac = el("text", { x: x - 15, y: y + 5, "font-size": 14, fill: col }); ac.textContent = s.alter > 0 ? "♯" : (s.alter < 0 ? "♭" : "♮"); }
      var hollow = kd.v >= 2;
      var head = el("ellipse", { cx: x, cy: y, rx: 5.6, ry: 4, transform: "rotate(-20 " + x + " " + y + ")", fill: hollow ? "#fbf8f1" : col, stroke: col, "stroke-width": 1.5, "data-id": n.id, style: "cursor:grab" });
      head.addEventListener("pointerdown", function (ev) { startDrag(ev, n); });
      if (kd.dot) el("circle", { cx: x + 10, cy: y - (pos % 2 === 0 ? 3 : 0), r: 1.6, fill: col });
      heads.push(sg);
    });
    /* 符幹・旗・連桁 */
    heads.forEach(function (sg) {
      if (sg.kd.v >= 4) return;
      var grp = sg.beam ? beamed[sg.beam] : null, up;
      if (grp) { var sum = 0; grp.forEach(function (g) { sum += g.pos; }); up = (sum / grp.length) < 4; } else up = sg.pos < 4;
      sg.up = up;
      var sx = up ? sg.x + 5 : sg.x - 5, sy = up ? sg.y - 28 : sg.y + 28;
      sg.sx = sx; sg.sy = sy;
      if (grp) return;                                        /* 連桁は後でまとめて描く */
      el("line", { x1: sx, x2: sx, y1: sg.y, y2: sy, stroke: sg.col, "stroke-width": 1.3 });
      var fl = sg.kd.v <= 0.25 ? 2 : (sg.kd.v <= 0.5 ? 1 : 0);
      for (f = 0; f < fl; f++) el("path", { d: "M" + sx + "," + (sy + (up ? f * 5 : -f * 5)) + " q6," + (up ? 4 : -4) + " 4," + (up ? 11 : -11), fill: "none", stroke: sg.col, "stroke-width": 1.4 });
    });
    Object.keys(beamed).forEach(function (kk) {
      var grp = beamed[kk].filter(function (g) { return g.sx != null && g.row === beamed[kk][0].row; });
      if (grp.length < 2) return;
      var up = grp[0].up, ext = up ? Math.min.apply(null, grp.map(function (g) { return g.sy; })) : Math.max.apply(null, grp.map(function (g) { return g.sy; }));
      grp.forEach(function (g) { el("line", { x1: g.sx, x2: g.sx, y1: g.y, y2: ext, stroke: g.col, "stroke-width": 1.3 }); });
      var x1 = grp[0].sx, x2 = grp[grp.length - 1].sx;
      el("rect", { x: x1, y: up ? ext : ext - 3.5, width: Math.max(1, x2 - x1), height: 3.5, fill: grp[0].col });
      if (grp.some(function (g) { return g.kd.v <= 0.25; })) el("rect", { x: x1, y: up ? ext + 6 : ext - 9.5, width: Math.max(1, x2 - x1), height: 3, fill: grp[0].col });
    });
    /* 3連符の括弧と「3」 */
    var tg = {};
    heads.forEach(function (sg) {
      if (!sg.kd.tri) return;
      var q = barOf(sg.t0), key = sg.row + ":" + q.bar + ":" + sg.kd.unit.toFixed(2) + ":" + Math.floor((q.beat + 1e-6) / sg.kd.unit);
      (tg[key] = tg[key] || []).push(sg);
    });
    Object.keys(tg).forEach(function (kk) {
      var g = tg[kk], xs = g.map(function (s) { return s.x; }), x1 = Math.min.apply(null, xs) - 5, x2 = Math.max.apply(null, xs) + 5, row = g[0].row;
      var top = Math.min.apply(null, g.map(function (s) { return Math.min(s.y - 10, (s.up && s.sy != null) ? s.sy - 4 : s.y - 10); })) - 4;
      if (!grand || staffOf(g[0].n) === 0) top = Math.min(top, yb(row) - 36);
      var xm = (x1 + x2) / 2;
      el("path", { d: "M" + x1 + "," + (top + 5) + " L" + x1 + "," + top + " L" + (xm - 7) + "," + top + " M" + (xm + 7) + "," + top + " L" + x2 + "," + top + " L" + x2 + "," + (top + 5), fill: "none", stroke: "#5a3d1e", "stroke-width": 1.1 });
      var tt = el("text", { x: xm - 3, y: top + 4, "font-size": 11, "font-style": "italic", "font-weight": "bold", fill: "#5a3d1e" }); tt.textContent = "3";
    });
    /* タイ：小節をまたぐ音符の、前の断片と次の断片をつなぐ */
    segs.forEach(function (sg) {
      if (sg.last) return;
      var nx = null, j;
      for (j = 0; j < segs.length; j++) if (segs[j].n === sg.n && Math.abs(segs[j].t0 - (sg.t0 + sg.d0)) < 1e-6) { nx = segs[j]; break; }
      if (!nx) return;
      var below = sg.pos >= 4, off2 = below ? -8 : 8;
      if (nx.row === sg.row) {
        el("path", { d: "M" + (sg.x + 5) + "," + (sg.y + off2) + " Q" + ((sg.x + nx.x) / 2) + "," + (sg.y + off2 * 2.2) + " " + (nx.x - 5) + "," + (nx.y + off2), fill: "none", stroke: sg.col, "stroke-width": 1.2 });
      } else {
        el("path", { d: "M" + (sg.x + 5) + "," + (sg.y + off2) + " q14," + (off2 * 0.8) + " 24,0", fill: "none", stroke: sg.col, "stroke-width": 1.2 });
        el("path", { d: "M" + (nx.x - 22) + "," + (nx.y + off2) + " q12," + (off2 * 0.8) + " 17,0", fill: "none", stroke: sg.col, "stroke-width": 1.2 });
      }
    });
    var sn = byId(sel), q0 = sn ? barOf(sn.t) : null;
    if (sn && barIn) barIn.value = q0.bar + 1;
    if (typeof lyIn !== "undefined" && lyIn) lyIn.value = sn && sn.ly ? sn.ly : "";
    var dTxt = sn ? (triOf(sn.d) ? "3連 " + (Math.round(sn.d * 100) / 100) : String(Math.round(sn.d * 1000) / 1000)) : "";
    snapBtn.textContent = "刻み：" + (SNAP === 0.25 ? "1/4拍" : "1/3拍（3連）");
    info.textContent = notes.length + "音" + (sn ? "（選択中：" + LET[spell(sn.p).li] + (spell(sn.p).alter > 0 ? "♯" : spell(sn.p).alter < 0 ? "♭" : "") + (Math.floor(sn.p / 12) - 1) + "・" + dTxt + "拍・" + (q0.bar + 1) + "小節）" : "") + "　ドラッグで移動／ダブルクリックで追加／Delete で削除";
  }
  function local(ev) { var rr = svg.getBoundingClientRect(); return { x: ev.clientX - rr.left, y: ev.clientY - rr.top }; }
  function snapBeat(v) { return Math.max(0, Math.round(v / SNAP) * SNAP); }
  function snapT(v) {                               /* 絶対の拍 → 小節の頭からの刻みに合わせる */
    var q = barOf(Math.max(0, v));
    return bstart(q.bar) + snapBeat(q.beat);
  }
  function startDrag(ev, n) {
    ev.preventDefault(); ev.stopPropagation();
    sel = n.id; wrap.focus();
    var p0 = local(ev), o = { t: n.t, p: n.p, pos: posOf(n.p) }, moved = false;
    if (cfg.audition) cfg.audition(n.p);
    pushUndo();
    function mv(e2) {
      var q = local(e2), dx = (q.x - p0.x) / ppb, dy = Math.round((p0.y - q.y) / STEP);
      n.t = snapT(o.t + dx);
      n.p = Math.max(36, Math.min(100, pitchAt(o.pos + dy)));
      if (Math.abs(q.x - p0.x) + Math.abs(q.y - p0.y) > 3) moved = true;
      render();
    }
    function up() {
      window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up);
      if (!moved) undo.pop(); else { if (cfg.audition && n.p !== o.p) cfg.audition(n.p); emit(); }
      render();
    }
    window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up);
    render();
  }
  svg.addEventListener("dblclick", function (ev) {
    var q = local(ev), row = Math.floor((q.y - 20) / L.SH), bi = null, i;
    if (row < 0 || row >= L.rows) return;
    for (i = 0; i < L.bars.length; i++) if (L.bars[i].row === row && q.x >= L.bars[i].x && q.x < L.bars[i].x + L.bars[i].w) { bi = L.bars[i]; break; }
    if (!bi) return;
    var beat = Math.min(bi.len - SNAP, snapBeat((q.x - bi.x - bi.pad - 8) / ppb)), t = bstart(bi.b) + Math.max(0, beat);
    var stD = (grand && q.y > yb(row) + 42) ? 1 : 0, pos = Math.round(((stD ? ybB(row) : yb(row)) - q.y) / STEP) - (stD ? 12 : 0);
    pushUndo();
    var n = { id: nextId++, t: Math.max(0, t), d: lastD, p: Math.max(36, Math.min(100, pitchAt(pos))), v: 82, c: 1 };
    notes.push(n); sel = n.id;
    if (cfg.audition) cfg.audition(n.p);
    render(); emit();
  });
  svg.addEventListener("pointerdown", function (ev) { if (ev.target === svg || ev.target.tagName === "line" || ev.target.tagName === "text" || ev.target.tagName === "rect" || ev.target.tagName === "path") { sel = null; render(); } });
  function edit(fn) { var n = byId(sel); if (!n) return; pushUndo(); fn(n); render(); emit(); }
  function del() { if (sel == null) return; pushUndo(); notes = notes.filter(function (n) { return n.id !== sel; }); sel = null; render(); emit(); }
  [["全", 4], ["2分", 2], ["付点4分", 1.5], ["4分", 1], ["付点8分", 0.75], ["8分", 0.5], ["16分", 0.25]].forEach(function (v) {
    mk(v[0], function () { lastD = v[1]; edit(function (n) { n.d = v[1]; }); });
  });
  [["3連2分", 4 / 3], ["3連4分", 2 / 3], ["3連8分", 1 / 3], ["3連16分", 1 / 6]].forEach(function (v) {
    mk(v[0], function () { lastD = v[1]; SNAP = 1 / 3; edit(function (n) { n.d = v[1]; }); });
  });
  var snapBtn = mk("刻み：1/4拍", function () { SNAP = (SNAP === 0.25 ? 1 / 3 : 0.25); render(); });
  mk("長く（+1拍）", function () { edit(function (n) { n.d = Math.min(16, n.d + 1); lastD = n.d; }); });
  mk("短く（−1刻み）", function () { edit(function (n) { n.d = Math.max(1 / 6, n.d - SNAP); lastD = n.d; }); });
  mk("♯", function () { edit(function (n) { n.p = Math.min(100, n.p + 1); if (cfg.audition) cfg.audition(n.p); }); });
  mk("♭", function () { edit(function (n) { n.p = Math.max(36, n.p - 1); if (cfg.audition) cfg.audition(n.p); }); });
  mk("♮", function () { edit(function (n) { n.p = pitchAt(posOf(n.p)) - (keyAlt[LET[spell(n.p).li]] || 0); }); });
  mk("削除", del);
  mk("元に戻す", popUndo);
  mk("拡大", function () { ppb = Math.min(90, ppb + 8); render(); });
  mk("縮小", function () { ppb = Math.max(28, ppb - 8); render(); });
  var grandBtn = mk(grand ? "大譜表：オン" : "大譜表：オフ", function () { grand = !grand; grandBtn.textContent = grand ? "大譜表：オン" : "大譜表：オフ"; render(); });
  var lyIn = document.createElement("input");                  /* 選んだ音の歌詞（音節） */
  lyIn.type = "text"; lyIn.placeholder = "歌詞"; lyIn.style.cssText = "width:80px"; lyIn.title = "選んだ音の歌詞（1音に1音節。空にすると消える）";
  lyIn.addEventListener("change", function () { var n = byId(sel); if (!n) return; pushUndo(); var v = lyIn.value.replace(/\s+/g, ""); if (v) n.ly = v; else delete n.ly; render(); emit(); });
  var lyLab = document.createElement("span"); lyLab.textContent = "歌詞：";
  bar.appendChild(lyLab); bar.appendChild(lyIn);
  /* 拍子の変更：指定の小節から（次の変更までの間）拍子を替える。小節の中身（何小節目の何拍目か）はそのまま保つ */
  var sigWrap = document.createElement("span");
  sigWrap.style.cssText = "display:inline-flex;gap:4px;align-items:center;margin-left:6px";
  var lab1 = document.createElement("span"); lab1.textContent = "拍子を変える：";
  var barIn = document.createElement("input"); barIn.type = "number"; barIn.min = "1"; barIn.value = "1"; barIn.style.cssText = "width:52px";
  var lab2 = document.createElement("span"); lab2.textContent = "小節目から";
  var sigSel = document.createElement("select");
  [[2, 4], [3, 4], [4, 4], [5, 4], [6, 4], [7, 4], [3, 8], [5, 8], [6, 8], [7, 8], [9, 8], [12, 8]].forEach(function (s) { var o = document.createElement("option"); o.value = s[0] + "/" + s[1]; o.textContent = s[0] + "/" + s[1]; if (s[0] === 4 && s[1] === 4) o.selected = true; sigSel.appendChild(o); });
  sigWrap.appendChild(lab1); sigWrap.appendChild(barIn); sigWrap.appendChild(lab2); sigWrap.appendChild(sigSel);
  bar.appendChild(sigWrap);
  function applySig(bar1, num, den) {
    var oldM = meters.map(function (m) { return { bar: m.bar, bpb: m.bpb, sig: m.sig }; });
    var nb = num * 4 / den / (cfg.unit || 1), nm = oldM.filter(function (m) { return m.bar !== bar1; }).concat([{ bar: bar1, bpb: nb, sig: [num, den] }]);
    nm = mtrNorm(nm, bpb0);
    pushUndo();
    notes.forEach(function (n) { n.t = mtrRemap(oldM, nm, n.t); });
    chords.forEach(function (c) { c.at = mtrRemap(oldM, nm, c.at); });
    meters = nm; render(); emit();
  }
  mk("この小節から拍子を変更", function () {
    var b1 = Math.max(1, parseInt(barIn.value, 10) || 1), p = sigSel.value.split("/");
    applySig(b1, parseInt(p[0], 10), parseInt(p[1], 10));
  });
  wrap.addEventListener("keydown", function (ev) {
    var k = ev.key;
    if (k === "Delete" || k === "Backspace") { ev.preventDefault(); del(); }
    else if (k === "ArrowLeft") { ev.preventDefault(); edit(function (n) { n.t = Math.max(0, n.t - SNAP); }); }
    else if (k === "ArrowRight") { ev.preventDefault(); edit(function (n) { n.t += SNAP; }); }
    else if (k === "ArrowUp") { ev.preventDefault(); edit(function (n) { n.p = Math.min(100, pitchAt(posOf(n.p) + 1)); if (cfg.audition) cfg.audition(n.p); }); }
    else if (k === "ArrowDown") { ev.preventDefault(); edit(function (n) { n.p = Math.max(36, pitchAt(posOf(n.p) - 1)); if (cfg.audition) cfg.audition(n.p); }); }
  });
  bar.appendChild(info);
  render();
  return {
    getNotes: snapshot,
    getMeters: metersOut,
    setNotes: function (arr, ms) {
      notes = arr.map(function (n) { return { id: nextId++, t: n.t, d: n.d, p: n.p, v: n.v || 82, c: n.c, ly: n.ly }; });
      if (ms) meters = mtrNorm(ms, bpb0);
      sel = null; undo = []; render();
    },
    destroy: function () { host.innerHTML = ""; }
  };
}
function pdfHeader(song, HH, extra) {
  var NN = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
  var sh = song.sheet || {}, o = song.opt || {}, f = song.form || {}, lines = [], l1 = [];
  if (o.tempo) l1.push((sh.ts && sh.ts[1] === 8 ? "♪" : "♩") + "=" + o.tempo);
  if (sh.tonic != null) l1.push("キー " + NN[((sh.tonic % 12) + 12) % 12] + (sh.minor ? "（短調）" : "（長調）"));
  if (sh.ts) l1.push("拍子 " + sh.ts[0] + "/" + sh.ts[1]);
  if (f.label) l1.push(String(f.label).split("（")[0]);
  lines.push(l1.join("　／　"));
  var l2 = [];
  if (HH && HH.STYLES && HH.STYLES[o.style]) l2.push(String(HH.STYLES[o.style].label).split("（")[0]);
  if (song.yamtrem) {
    var NAMES = { auto: "おまかせ（小節ごとに変化）", basic: "基本（根音・5度・根音の上・5度）", third: "3度（根音・3度の上・5度・3度の上）", fifth: "5度（根音・5度・3度の上・5度）", pedal: "根音の反復（根音・オクターヴ上）" };
    l2.push("親指の低音の型：" + (NAMES[song.yamtrem.bassMode] || NAMES.auto));
    l2.push(song.yamtrem.flam ? "奏法 p-i-a-m-i（1拍5つ割り）" : "奏法 p-a-m-i（1拍4つ割り）");
  }
  if (o.seed) l2.push("シード " + o.seed);
  if (HH && HH.BUILD) l2.push("build #" + HH.BUILD);
  lines.push(l2.join("　／　"));
  (extra || []).forEach(function (ln) { lines.push(ln); });
  return { title: String(song.title || "").replace(/\s+\[p-[^\]]+\]$/, ""), lines: lines };
}
function makePdf(pages, PW, PH, MG) {
  var parts = [], offs = [], len = 0, enc = function (s) { var a = new Uint8Array(s.length), i; for (i = 0; i < s.length; i++) a[i] = s.charCodeAt(i) & 255; return a; };
  function push(b) { parts.push(b); len += b.length; }
  function obj(n, body) { offs[n] = len; push(enc(n + " 0 obj\n")); (typeof body === "string") ? push(enc(body)) : push(body); push(enc("\nendobj\n")); }
  var nP = pages.length, kids = [], i;
  push(enc("%PDF-1.4\n"));
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  for (i = 0; i < nP; i++) kids.push((3 + i * 3) + " 0 R");
  obj(2, "<< /Type /Pages /Kids [" + kids.join(" ") + "] /Count " + nP + " >>");
  for (i = 0; i < nP; i++) {
    var pg = pages[i], base = 3 + i * 3, dw = PW - MG * 2, dh = dw * pg.h / pg.w, y = PH - MG - dh;
    obj(base, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + PW + " " + PH + "] /Contents " + (base + 1) + " 0 R /Resources << /XObject << /Im0 " + (base + 2) + " 0 R >> >> >>");
    var cs = "q " + dw.toFixed(2) + " 0 0 " + dh.toFixed(2) + " " + MG + " " + y.toFixed(2) + " cm /Im0 Do Q";
    obj(base + 1, "<< /Length " + cs.length + " >>\nstream\n" + cs + "\nendstream");
    var head = enc("<< /Type /XObject /Subtype /Image /Width " + pg.w + " /Height " + pg.h + " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " + pg.jpg.length + " >>\nstream\n");
    var tail = enc("\nendstream");
    var all = new Uint8Array(head.length + pg.jpg.length + tail.length);
    all.set(head, 0); all.set(pg.jpg, head.length); all.set(tail, head.length + pg.jpg.length);
    obj(base + 2, all);
  }
  var xr = len, nObj = 3 + nP * 3, x = "xref\n0 " + nObj + "\n0000000000 65535 f \n";
  for (i = 1; i < nObj; i++) x += ("0000000000" + offs[i]).slice(-10) + " 00000 n \n";
  push(enc(x + "trailer\n<< /Size " + nObj + " /Root 1 0 R >>\nstartxref\n" + xr + "\n%%EOF\n"));
  var out = new Uint8Array(len), p = 0;
  parts.forEach(function (b) { out.set(b, p); p += b.length; });
  return out;
}

/* ---------- 曲を音声にする（WAV・MP3）----------
   曲を約20秒ずつの窓に区切り、窓ごとに OfflineAudioContext へ内蔵音源で描画して重ねる（tools/render_mp3.js と同じ方法）。
   読み込んだ音声ループが有効なら、同じ長さの別の描画で重ねる。ピークは -1dBFS に合わせる。 */
function renderSongAudio(song, opts, progress) {
  opts = opts || {};
  var SR = 44100, W = 20, TAIL = 6;
  return new Promise(function (resolve, reject) {
    var RealAC = root.AudioContext, RealWK = root.webkitAudioContext;
    var restore = function () { root.AudioContext = RealAC; root.webkitAudioContext = RealWK; };
    try {
      var probe = new Engine(); probe.load(song, false);
      var spb = probe.spb, evsAll = probe.evs.slice(), secs = Math.ceil(song.totalBeats * spb + 4), N = secs * SR;
      if (opts.only) evsAll = evsAll.filter(function (ev) { return opts.only.indexOf(ev.k) >= 0; });
      /* 既定で消音のパート（ジプシーのピアノ）は、消音中なら音の書き出しに入れない（MIDI・譜面には入る） */
      if (!opts.only) { var muX = (root.__hcgEng && root.__hcgEng.mute) || {}, dmK = {}; song.stems.forEach(function (s0) { if (s0.defaultMute && muX[s0.id]) dmK[s0.id] = 1; }); evsAll = evsAll.filter(function (ev) { return !dmK[ev.k]; }); }        /* パートごとの書き出し：そのパートの音だけ */
      if (opts.loop && opts.loop.vst && opts.loop.replace) evsAll = evsAll.filter(function (ev) { return opts.loop.replace.indexOf(ev.k) < 0; });   /* VST の音で置き換えたパートは、内蔵の音を入れない */
      var L = new Float32Array(N), R = new Float32Array(N), starts = [], st;
      for (st = 0; st < secs; st += W) starts.push(st);
      var wi = 0;
      var step = function () {
        if (wi >= starts.length) {
          restore();
          if (opts.loop && opts.loop.buf) {
            var lp = opts.loop, lb = lp.bars * lp.bpb, sec = lb * spb, rate = lp.buf.duration / sec;
            var off2 = new OfflineAudioContext(2, N, SR), g2 = off2.createGain();
            g2.gain.value = 0.9 * (lp.gain == null ? 1 : lp.gain); g2.connect(off2.destination);
            var k;
            for (k = 0; ; k++) {
              var tb = lp.start + k * lb;
              if (tb >= song.totalBeats - 0.01) break;
              var s0 = tb * spb, src = off2.createBufferSource();
              src.buffer = lp.buf; src.playbackRate.value = rate; src.connect(g2); src.start(s0); src.stop(Math.min(secs, s0 + sec + 0.05));
            }
            off2.startRendering().then(function (lb2) {
              var a = lb2.getChannelData(0), b2 = lb2.getChannelData(lb2.numberOfChannels > 1 ? 1 : 0), i;
              for (i = 0; i < N && i < a.length; i++) { L[i] += a[i]; R[i] += b2[i]; }
              finish();
            }, function () { finish(); });
          } else finish();
          return;
        }
        var s = starts[wi++];
        if (progress) progress(wi, starts.length);
        var sel = evsAll.filter(function (ev) { return ev.s >= s && ev.s < s + W; });
        if (!sel.length) { setTimeout(step, 0); return; }
        var len = Math.min(W + TAIL, secs - s + 1), off = new OfflineAudioContext(2, Math.ceil(len * SR), SR);
        root.AudioContext = function () { return off; }; root.webkitAudioContext = root.AudioContext;
        var eng = new Engine();
        eng.ensure(); eng.load(song, false);
        eng.evs = []; eng.play(0); clearInterval(eng.timer); eng.playing = false;
        sel.forEach(function (ev) { try { eng.voice(ev.k, ev.p + (ev.mic || 0), Math.max(0, eng.t0 + ev.s - s), ev.d, ev.v); } catch (x) {} });
        restore();
        off.startRendering().then(function (buf) {
          var bl = buf.getChannelData(0), br = buf.getChannelData(buf.numberOfChannels > 1 ? 1 : 0), o0 = Math.round(s * SR), i;
          for (i = 0; i < bl.length && o0 + i < N; i++) { L[o0 + i] += bl[i]; R[o0 + i] += br[i]; }
          setTimeout(step, 0);
        }, function (er) { reject(er); });
      };
      var finish = function () {
        var pk = 0, i;
        for (i = 0; i < N; i += 7) { var a2 = Math.abs(L[i]), b3 = Math.abs(R[i]); if (a2 > pk) pk = a2; if (b3 > pk) pk = b3; }
        if (!(pk > 0.0005)) { if (opts.gain) { resolve({ L: L, R: R, sr: SR, secs: secs, silent: true, gain: opts.gain }); return; } reject(new Error("無音でした")); return; }
        if (opts.raw) { resolve({ L: L, R: R, sr: SR, secs: secs, peak: pk }); return; }        /* 検査用：音量をそのまま返す */
        /* 音量：鳴っている部分（−60dB より上）の実効値（RMS）を −17dBFS 前後にそろえ、ピークはなだらかに抑える（曲ごとの音量差を小さくする） */
        var fr = Math.round(SR * 0.05), nf = Math.floor(N / fr), ms = 0, cnt = 0, q, z;
        for (q = 0; q < nf; q++) {
          var s2 = 0;
          for (z = 0; z < fr; z += 3) { var xa = L[q * fr + z], xb = R[q * fr + z]; s2 += xa * xa + xb * xb; }
          s2 /= (2 * (fr / 3));
          if (s2 > 1e-6) { ms += s2; cnt++; }
        }
        var rmsG = cnt ? Math.sqrt(ms / cnt) : 0, g = 0.89 / pk, tgtR = opts.rms || 0.14, capP = opts.pcap || 1.8;      /* 標準：実効値 約 −17dBFS・ピーク上限 1.8／大きめ・最大：尖った音をなだらかに抑えて、全体を持ち上げる */
        if (rmsG > 1e-5) g = Math.min(tgtR / rmsG, capP / pk);          /* 目標の実効値。ピークが大きい曲は上限で止める */
        if (opts.gain) g = opts.gain;                                   /* パートごとの書き出し：全体の音量の倍率をそのまま使う（パートの音量の関係を保つ） */
        var K = 0.72;                                                  /* これを超える山は、なだらかに丸める（ソフトリミッター） */
        for (i = 0; i < N; i++) {
          var xl = L[i] * g, xr = R[i] * g;
          if (xl > K) xl = K + (1 - K) * Math.tanh((xl - K) / (1 - K)); else if (xl < -K) xl = -K - (1 - K) * Math.tanh((-xl - K) / (1 - K));
          if (xr > K) xr = K + (1 - K) * Math.tanh((xr - K) / (1 - K)); else if (xr < -K) xr = -K - (1 - K) * Math.tanh((-xr - K) / (1 - K));
          L[i] = xl * 0.97; R[i] = xr * 0.97;
        }
        resolve({ L: L, R: R, sr: SR, secs: secs, rms: rmsG * g, gain: g });
      };
      step();
    } catch (er) { restore(); reject(er); }
  });
}
function wavBytes(L, R, sr) {
  var n = L.length, out = new Uint8Array(44 + n * 4), dv = new DataView(out.buffer), i, o = 44;
  var w = function (p, s) { for (var q = 0; q < s.length; q++) dv.setUint8(p + q, s.charCodeAt(q)); };
  w(0, "RIFF"); dv.setUint32(4, 36 + n * 4, true); w(8, "WAVEfmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 2, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * 4, true); dv.setUint16(32, 4, true); dv.setUint16(34, 16, true); w(36, "data"); dv.setUint32(40, n * 4, true);
  for (i = 0; i < n; i++, o += 4) {
    dv.setInt16(o, Math.max(-1, Math.min(1, L[i])) * 32767, true);
    dv.setInt16(o + 2, Math.max(-1, Math.min(1, R[i])) * 32767, true);
  }
  return out;
}
/* MP3：lamejs（cdnjs）を必要なときだけ読み込む。読み込めない（オフライン等）ときは null を返す */
function loadLame() {
  return new Promise(function (resolve) {
    if (root.lamejs) { resolve(root.lamejs); return; }
    try {
      var s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/lamejs/1.2.1/lame.min.js";
      s.onload = function () { resolve(root.lamejs || null); };
      s.onerror = function () { resolve(null); };
      document.head.appendChild(s);
      setTimeout(function () { if (!root.lamejs) resolve(null); }, 20000);
    } catch (e) { resolve(null); }
  });
}
function mp3Bytes(L, R, sr, kbps) {
  return loadLame().then(function (lame) {
    if (!lame) return null;
    var enc = new lame.Mp3Encoder(2, sr, kbps || 192), n = L.length, out = [], i, BS = 1152;
    var l16 = new Int16Array(BS), r16 = new Int16Array(BS);
    for (i = 0; i < n; i += BS) {
      var m = Math.min(BS, n - i), j;
      for (j = 0; j < m; j++) { l16[j] = Math.max(-1, Math.min(1, L[i + j])) * 32767; r16[j] = Math.max(-1, Math.min(1, R[i + j])) * 32767; }
      var b = enc.encodeBuffer(m === BS ? l16 : l16.subarray(0, m), m === BS ? r16 : r16.subarray(0, m));
      if (b.length) out.push(new Uint8Array(b));
    }
    var f = enc.flush();
    if (f.length) out.push(new Uint8Array(f));
    var tot = 0; out.forEach(function (c) { tot += c.length; });
    var all = new Uint8Array(tot), p = 0;
    out.forEach(function (c) { all.set(c, p); p += c.length; });
    return all;
  });
}

root.HCGX = {
  noteEditor: noteEditor, staffEditor: staffEditor, renderSongAudio: renderSongAudio, wavBytes: wavBytes, mp3Bytes: mp3Bytes,
  scorePdf: scorePdf,
  Engine: Engine, SFStore: SFStore, saveFiles: saveFiles, dlReady: dlReady, sf2Parse: sf2Parse, saveBytes: saveBytes, saveText: saveText, shareBytes: shareBytes,
  drawRoll: function (cv, song, playBeat, mute) { drawRoll(cv, song, playBeat, mute); orchHook(song, playBeat, mute); },
  drawScore: drawScore, COLORS: COLORS,
  _synth: { ks: ksBuffer, metal: metalBuf, noise: noiseBuf, ir: irBuffer }
};
})(typeof window !== "undefined" ? window : globalThis);
