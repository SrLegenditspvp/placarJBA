'use strict';

const STORAGE_KEY = 'jba-scoreboard-v2';
const CHANNEL_NAME = 'jba-scoreboard-sync';
const channel = 'BroadcastChannel' in window ? new BroadcastChannel(CHANNEL_NAME) : null;

const TEAM_COLORS = {
  preto: { label: 'PRETO' },
  amarelo: { label: 'AMARELO' },
  verde: { label: 'VERDE' },
  azul: { label: 'AZUL' }
};

const DEFAULT_SETTINGS = {
  quarterMinutes: 10,
  overtimeMinutes: 5,
  shotClockSeconds: 24,
  timeoutSeconds: 60,
  teamFoulLimit: 4,
  firstHalfTimeouts: 2,
  secondHalfTimeouts: 3,
  overtimeTimeouts: 1
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const localDate = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const clone = (value) => JSON.parse(JSON.stringify(value));

function makeTeam(color) {
  return {
    color,
    score: 0,
    periodScores: { '1': 0, '2': 0, '3': 0, '4': 0 },
    teamFouls: { '1': 0, '2': 0, '3': 0, '4+': 0 },
    timeouts: { firstHalf: 0, secondHalf: 0, overtime: {} }
  };
}

function makeDefaultState() {
  return {
    version: 2,
    meta: { competition: 'JBA', category: '', venue: '', date: localDate() },
    settings: { ...DEFAULT_SETTINGS },
    period: 1,
    overtimeNumber: 0,
    started: false,
    finished: false,
    clock: { remaining: DEFAULT_SETTINGS.quarterMinutes * 60, deadline: null, running: false },
    shotClock: { remaining: DEFAULT_SETTINGS.shotClockSeconds, deadline: null, running: false },
    timeoutClock: { remaining: 0, deadline: null, running: false, side: null },
    possession: null,
    teams: { home: makeTeam('preto'), away: makeTeam('amarelo') },
    events: [],
    undoStack: []
  };
}

function normaliseTimer(timer) {
  if (timer.running && Number.isFinite(timer.deadline)) {
    timer.remaining = Math.max(0, (timer.deadline - Date.now()) / 1000);
    if (timer.remaining <= 0) {
      timer.remaining = 0;
      timer.running = false;
      timer.deadline = null;
    }
  } else {
    timer.running = false;
    timer.deadline = null;
    timer.remaining = Math.max(0, Number(timer.remaining) || 0);
  }
}

function mergeState(raw) {
  const base = makeDefaultState();
  if (!raw || typeof raw !== 'object' || !raw.teams || !raw.settings) return base;
  const state = { ...base, ...raw };
  state.version = 2;
  state.meta = { ...base.meta, ...(raw.meta || {}) };
  state.settings = { ...DEFAULT_SETTINGS, ...(raw.settings || {}) };
  state.clock = { ...base.clock, ...(raw.clock || {}) };
  state.shotClock = { ...base.shotClock, ...(raw.shotClock || {}) };
  state.timeoutClock = { ...base.timeoutClock, ...(raw.timeoutClock || {}) };
  const previousHomeColor = raw.teams.home?.color;
  const previousAwayColor = raw.teams.away?.color;
  state.teams = {
    home: { ...makeTeam(TEAM_COLORS[previousHomeColor] ? previousHomeColor : 'preto'), ...(raw.teams.home || {}) },
    away: { ...makeTeam(TEAM_COLORS[previousAwayColor] ? previousAwayColor : 'amarelo'), ...(raw.teams.away || {}) }
  };
  if (state.teams.home.color === state.teams.away.color) state.teams.away.color = state.teams.home.color === 'amarelo' ? 'preto' : 'amarelo';
  for (const side of ['home', 'away']) {
    const team = state.teams[side];
    team.periodScores = { '1': 0, '2': 0, '3': 0, '4': 0, ...(team.periodScores || {}) };
    team.teamFouls = { '1': 0, '2': 0, '3': 0, '4+': 0, ...(team.teamFouls || {}) };
    team.timeouts = { firstHalf: 0, secondHalf: 0, overtime: {}, ...(team.timeouts || {}) };
    team.timeouts.overtime = team.timeouts.overtime || {};
  }
  state.events = Array.isArray(state.events) ? state.events : [];
  state.undoStack = [];
  state.period = Math.max(1, Number(state.period) || 1);
  state.overtimeNumber = Math.max(0, Number(state.overtimeNumber) || Math.max(0, state.period - 4));
  normaliseTimer(state.clock);
  normaliseTimer(state.shotClock);
  normaliseTimer(state.timeoutClock);
  return state;
}

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? mergeState(JSON.parse(saved)) : makeDefaultState();
  } catch (error) {
    console.warn('Não foi possível carregar o placar salvo:', error);
    return makeDefaultState();
  }
}

let state = loadState();
let toastTimer = null;
let endBeepPlayed = { game: false, shot: false };

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (channel) channel.postMessage({ type: 'scoreboard-updated' });
    const indicator = $('#saveIndicator');
    if (indicator) indicator.innerHTML = '<i></i> SALVO AUTOMATICAMENTE';
    const message = $('#saveMessage');
    if (message) message.textContent = 'Dados salvos neste navegador';
  } catch (error) {
    console.error(error);
    showToast('Não foi possível salvar os dados neste navegador.');
  }
}

function snapshotForUndo() {
  const previous = clone(state);
  previous.undoStack = [];
  state.undoStack.push(previous);
  if (state.undoStack.length > 35) state.undoStack.shift();
}

function undoLastAction() {
  if (!state.undoStack.length) return showToast('Não há ação para desfazer.');
  const stack = state.undoStack;
  const previous = stack[stack.length - 1];
  state = previous;
  state.undoStack = stack.slice(0, -1);
  saveState();
  render();
  showToast('Última ação desfeita.');
}

function currentValue(timer) {
  if (timer.running && Number.isFinite(timer.deadline)) return Math.max(0, (timer.deadline - Date.now()) / 1000);
  return Math.max(0, Number(timer.remaining) || 0);
}

function pauseTimer(timer) {
  timer.remaining = currentValue(timer);
  timer.running = false;
  timer.deadline = null;
}

function startTimer(timer) {
  const remaining = currentValue(timer);
  if (remaining <= 0) return false;
  timer.remaining = remaining;
  timer.deadline = Date.now() + remaining * 1000;
  timer.running = true;
  return true;
}

function pauseGameClocks() {
  pauseTimer(state.clock);
  pauseTimer(state.shotClock);
}

function beep(frequency = 880, duration = 0.24) {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'square';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.13, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + duration + 0.03);
    oscillator.onended = () => context.close();
  } catch (_) { /* áudio opcional */ }
}

function teamName(side) {
  return TEAM_COLORS[state.teams[side].color]?.label || 'EQUIPE';
}
function periodKey() { return state.period >= 4 ? '4+' : String(state.period); }
function scorePeriodKey() { return state.period >= 5 ? `OT${state.overtimeNumber || state.period - 4}` : String(state.period); }
function periodDuration() { return (state.period >= 5 ? state.settings.overtimeMinutes : state.settings.quarterMinutes) * 60; }
function periodName() {
  return state.period <= 4 ? `${state.period}º QUARTO` : `${state.overtimeNumber || state.period - 4}ª PRORROGAÇÃO`;
}
function formatClock(seconds) {
  const value = Math.max(0, seconds);
  if (value < 60) return `${String(Math.floor(value)).padStart(2, '0')}.${Math.floor((value % 1) * 10)}`;
  const whole = Math.ceil(value);
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
}
function formatEventTime(seconds) {
  const whole = Math.ceil(Math.max(0, seconds));
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
}
function formatCountdown(seconds) {
  const whole = Math.ceil(Math.max(0, seconds));
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
}
function formatShotClock(seconds) {
  const value = Math.max(0, seconds);
  return value <= 5 && value > 0 ? value.toFixed(1) : String(Math.ceil(value));
}
function currentTeamFouls(side) { return Number(state.teams[side].teamFouls[periodKey()] || 0); }

function timeoutsLeft(side) {
  const team = state.teams[side];
  if (state.period <= 2) return Math.max(0, state.settings.firstHalfTimeouts - Number(team.timeouts.firstHalf || 0));
  if (state.period <= 4) return Math.max(0, state.settings.secondHalfTimeouts - Number(team.timeouts.secondHalf || 0));
  return Math.max(0, state.settings.overtimeTimeouts - Number(team.timeouts.overtime[state.overtimeNumber] || 0));
}

function pushEvent(description, side = null, type = 'info') {
  const clockText = `${periodName()} · ${formatEventTime(currentValue(state.clock))}`;
  state.events.unshift({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, time: clockText, description, side, type });
  if (state.events.length > 160) state.events.length = 160;
}

function renderTeamColor(side) {
  const color = state.teams[side].color;
  const card = $(`#${side}TeamCard`);
  const dot = $(`#${side}ColorDot`);
  const select = $(`#${side}TeamSelect`);
  card.dataset.color = color;
  dot.dataset.color = color;
  select.value = color;
  const otherSide = side === 'home' ? 'away' : 'home';
  Array.from(select.options).forEach((option) => {
    option.disabled = option.value === state.teams[otherSide].color && option.value !== color;
  });
}

function renderLiveClocks() {
  const remaining = currentValue(state.clock);
  const shotRemaining = currentValue(state.shotClock);
  const timeoutRemaining = currentValue(state.timeoutClock);
  $('#gameClock').textContent = formatClock(remaining);
  $('#gameClock').classList.toggle('clock-zero', remaining <= 0);
  $('#shotClock').textContent = formatShotClock(shotRemaining);
  $('#shotClock').classList.toggle('clock-zero', shotRemaining <= 0);
  $('#toggleGameClock').textContent = state.clock.running ? 'Ⅱ Pausar' : '▶ Iniciar';
  $('#shotToggleBtn').textContent = state.shotClock.running ? 'Ⅱ' : '▶';
  $('#matchStatus').textContent = state.finished ? 'FIM DE JOGO' : remaining <= 0 ? 'TEMPO ENCERRADO' : state.clock.running ? 'AO VIVO' : state.started ? 'JOGO PAUSADO' : 'AGUARDANDO INÍCIO';
  $('#timeoutDisplay').hidden = !state.timeoutClock.running && timeoutRemaining <= 0;
  $('#timeoutClock').textContent = formatCountdown(timeoutRemaining);
}

function renderScoreboard() {
  $('#periodLabel').textContent = periodName();
  $('#homeScore').textContent = state.teams.home.score;
  $('#awayScore').textContent = state.teams.away.score;
  $('#homeTeamFouls').textContent = currentTeamFouls('home');
  $('#awayTeamFouls').textContent = currentTeamFouls('away');
  $('#homeTeamFouls').classList.toggle('penalty-active', currentTeamFouls('home') >= state.settings.teamFoulLimit);
  $('#awayTeamFouls').classList.toggle('penalty-active', currentTeamFouls('away') >= state.settings.teamFoulLimit);
  $('#homeTimeouts').textContent = timeoutsLeft('home');
  $('#awayTimeouts').textContent = timeoutsLeft('away');
  renderTeamColor('home');
  renderTeamColor('away');

  $('#possessionHome').textContent = `◀ ${teamName('home')}`;
  $('#possessionAway').textContent = `${teamName('away')} ▶`;
  $('#possessionHome').classList.toggle('active', state.possession === 'home');
  $('#possessionAway').classList.toggle('active', state.possession === 'away');
  renderPeriodPoints();
  renderLiveClocks();
}

function renderPeriodPoints() {
  const keys = ['1', '2', '3', '4'];
  for (let index = 1; index <= Math.max(0, state.period - 4); index += 1) keys.push(`OT${index}`);
  const labels = (key) => key.startsWith('OT') ? key : `${key}Q`;
  const columns = keys.map((key) => `<div class="period-column"><span>${labels(key)}</span><strong>${Number(state.teams.home.periodScores[key] || 0)}</strong><strong>${Number(state.teams.away.periodScores[key] || 0)}</strong></div>`).join('');
  $('#periodPoints').innerHTML = `<span class="partial-label">PARCIAIS</span><div class="period-score-table">${columns}<div class="period-column total"><span>TOTAL</span><strong>${state.teams.home.score}</strong><strong>${state.teams.away.score}</strong></div></div>`;
}

function renderEvents() {
  const list = $('#eventList');
  if (!state.events.length) {
    list.innerHTML = '<li class="empty-events">Os registros da partida aparecerão aqui.</li>';
    return;
  }
  list.innerHTML = state.events.slice(0, 25).map((event) => {
    const validSide = event.side === 'home' || event.side === 'away';
    const tag = validSide ? teamName(event.side) : 'JBA';
    const allowedTypes = ['score', 'foul', 'timeout', 'clock', 'period', 'final', 'info'];
    const type = allowedTypes.includes(event.type) ? event.type : 'info';
    return `<li class="event-item event-${type}"><time>${escapeHtml(event.time)}</time><span class="event-tag">${escapeHtml(tag)}</span><p>${escapeHtml(event.description)}</p></li>`;
  }).join('');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function renderMeta() {
  $('#competitionInput').value = state.meta.competition;
  $('#categoryInput').value = state.meta.category;
  $('#venueInput').value = state.meta.venue;
  $('#dateInput').value = state.meta.date;
  $('#matchTitle').textContent = `${state.meta.competition || 'JBA'} · ${state.meta.category || 'Campeonato local'}`;
}

function renderSettings() {
  const form = $('#settingsForm');
  for (const [key, value] of Object.entries(state.settings)) {
    if (form.elements[key]) form.elements[key].value = value;
  }
}

function render() {
  renderMeta();
  renderSettings();
  renderScoreboard();
  renderEvents();
}

function registerPoints(side, points) {
  if (state.finished) return showToast('A partida já foi encerrada.');
  snapshotForUndo();
  const team = state.teams[side];
  team.score = Math.max(0, team.score + points);
  const key = scorePeriodKey();
  team.periodScores[key] = Math.max(0, Number(team.periodScores[key] || 0) + points);
  pushEvent(`${teamName(side)} ${points > 0 ? `marcou ${points} ponto(s)` : `teve ${Math.abs(points)} ponto(s) retirado(s)`}.`, side, 'score');
  saveState();
  renderScoreboard();
  renderEvents();
}

function addTeamFoul(side) {
  if (state.finished) return showToast('A partida já foi encerrada.');
  snapshotForUndo();
  const value = currentTeamFouls(side) + 1;
  state.teams[side].teamFouls[periodKey()] = value;
  const bonus = value >= state.settings.teamFoulLimit ? ' A equipe entrou na penalidade.' : '';
  pushEvent(`${teamName(side)}: falta de equipe (${value}ª no período).${bonus}`, side, 'foul');
  saveState();
  renderScoreboard();
  renderEvents();
}

function registerTimeout(side) {
  if (state.finished) return showToast('A partida já foi encerrada.');
  if (timeoutsLeft(side) <= 0) return showToast(`${teamName(side)} não possui mais tempos neste período.`);
  snapshotForUndo();
  const team = state.teams[side];
  if (state.period <= 2) team.timeouts.firstHalf += 1;
  else if (state.period <= 4) team.timeouts.secondHalf += 1;
  else team.timeouts.overtime[state.overtimeNumber] = Number(team.timeouts.overtime[state.overtimeNumber] || 0) + 1;
  pauseGameClocks();
  state.timeoutClock.remaining = state.settings.timeoutSeconds;
  state.timeoutClock.side = side;
  startTimer(state.timeoutClock);
  pushEvent(`${teamName(side)} solicitou tempo técnico.`, side, 'timeout');
  saveState();
  render();
}

function finishTimeout() {
  pauseTimer(state.timeoutClock);
  state.timeoutClock.remaining = 0;
  state.timeoutClock.side = null;
  pushEvent('Tempo técnico encerrado.', null, 'timeout');
  saveState();
  renderScoreboard();
  renderEvents();
}

function adjustGameClock(amount) {
  snapshotForUndo();
  pauseGameClocks();
  state.clock.remaining = Math.max(0, Math.min(periodDuration(), currentValue(state.clock) + amount));
  endBeepPlayed.game = false;
  saveState();
  renderScoreboard();
}

function resetGameClock() {
  if (!confirm(`Reiniciar o relógio para ${formatEventTime(periodDuration())}?`)) return;
  snapshotForUndo();
  pauseGameClocks();
  state.clock.remaining = periodDuration();
  state.shotClock.remaining = state.settings.shotClockSeconds;
  state.started = false;
  endBeepPlayed = { game: false, shot: false };
  pushEvent(`Relógios reiniciados no ${periodName()}.`, null, 'clock');
  saveState();
  render();
}

function resetShotClock(seconds) {
  snapshotForUndo();
  pauseTimer(state.shotClock);
  state.shotClock.remaining = seconds;
  endBeepPlayed.shot = false;
  pushEvent(`Relógio de arremesso ajustado para ${seconds} segundos.`, null, 'clock');
  saveState();
  renderScoreboard();
  renderEvents();
}

function changePeriod(direction) {
  if (state.finished && direction > 0) return showToast('A partida já foi encerrada.');
  if (direction > 0 && state.period >= 4 && state.teams.home.score !== state.teams.away.score) {
    snapshotForUndo();
    pauseGameClocks();
    pauseTimer(state.timeoutClock);
    state.timeoutClock.remaining = 0;
    state.timeoutClock.side = null;
    state.finished = true;
    state.started = false;
    pushEvent(`Fim de jogo: ${teamName(state.teams.home.score > state.teams.away.score ? 'home' : 'away')} venceu.`, null, 'final');
    saveState();
    render();
    showToast('Partida encerrada.');
    return;
  }
  if (direction < 0 && state.period <= 1) return showToast('Você já está no primeiro quarto.');

  snapshotForUndo();
  if (direction > 0) {
    if (state.period === 4) {
      state.period = 5;
      state.overtimeNumber = 1;
    } else if (state.period >= 5) {
      state.period += 1;
      state.overtimeNumber += 1;
    } else state.period += 1;
  } else {
    state.period -= 1;
    state.overtimeNumber = Math.max(0, state.period - 4);
    state.finished = false;
  }
  pauseGameClocks();
  pauseTimer(state.timeoutClock);
  state.timeoutClock.remaining = 0;
  state.timeoutClock.side = null;
  state.clock.remaining = periodDuration();
  state.shotClock.remaining = state.settings.shotClockSeconds;
  state.started = false;
  state.possession = null;
  endBeepPlayed = { game: false, shot: false };
  pushEvent(`Início do ${periodName()}.`, null, 'period');
  saveState();
  render();
  showToast(`${periodName()} configurado.`);
}

function saveMatchMeta() {
  snapshotForUndo();
  state.meta = {
    competition: $('#competitionInput').value.trim() || 'JBA',
    category: $('#categoryInput').value.trim(),
    venue: $('#venueInput').value.trim(),
    date: $('#dateInput').value || localDate()
  };
  pushEvent('Dados da partida atualizados.', null, 'info');
  saveState();
  renderMeta();
  renderEvents();
  showToast('Dados da partida salvos.');
}

function changeTeamColor(side, color) {
  if (!TEAM_COLORS[color]) return;
  const otherSide = side === 'home' ? 'away' : 'home';
  if (state.teams[otherSide].color === color) {
    showToast('Escolha uma cor diferente para cada equipe.');
    renderScoreboard();
    return;
  }
  snapshotForUndo();
  const oldName = teamName(side);
  state.teams[side].color = color;
  pushEvent(`${oldName} foi alterado para ${TEAM_COLORS[color].label}.`, side, 'info');
  saveState();
  renderScoreboard();
  renderEvents();
}


function changePossession(side) {
  snapshotForUndo();
  state.possession = state.possession === side ? null : side;
  const description = state.possession ? `Seta de posse alternada para ${teamName(side)}.` : 'Seta de posse alternada removida.';
  pushEvent(description, state.possession, 'info');
  saveState();
  renderScoreboard();
  renderEvents();
}

function saveSettings(form) {
  const data = new FormData(form);
  const settings = {};
  for (const key of Object.keys(DEFAULT_SETTINGS)) settings[key] = Number(data.get(key));
  if (Object.entries(settings).some(([key, value]) => !Number.isFinite(value) || value < 0 || value > (key.includes('Minutes') ? 20 : 180))) {
    return showToast('Confira os valores das configurações.');
  }
  snapshotForUndo();
  state.settings = settings;
  if (!state.clock.running && state.clock.remaining > periodDuration()) state.clock.remaining = periodDuration();
  pushEvent('Configurações do placar atualizadas.', null, 'info');
  saveState();
  render();
  showToast('Configurações salvas.');
}

function restoreDefaults() {
  if (!confirm('Restaurar as configurações padrão do placar?')) return;
  snapshotForUndo();
  pauseGameClocks();
  state.settings = { ...DEFAULT_SETTINGS };
  state.clock.remaining = periodDuration();
  state.shotClock.remaining = state.settings.shotClockSeconds;
  saveState();
  render();
  showToast('Configurações padrão restauradas.');
}

function exportFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function exportBackup() {
  const backup = clone(state);
  backup.undoStack = [];
  exportFile(`jba-placar-backup-${localDate()}.json`, JSON.stringify(backup, null, 2), 'application/json');
}

function importBackup(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result));
      if (!parsed || !parsed.teams || !parsed.settings || !parsed.clock) throw new Error('Arquivo não reconhecido.');
      if (!confirm('Importar este backup substituirá a partida aberta. Deseja continuar?')) return;
      state = mergeState(parsed);
      saveState();
      render();
      showToast('Backup importado.');
    } catch (error) {
      showToast(`Não foi possível importar: ${error.message}`);
    }
  };
  reader.onerror = () => showToast('Falha ao ler o arquivo.');
  reader.readAsText(file);
}

function newMatch() {
  if (!confirm('Zerar placar, faltas, tempos, cronômetros e histórico para começar uma nova partida?')) return;
  const settings = clone(state.settings);
  const meta = clone(state.meta);
  const homeColor = state.teams.home.color;
  const awayColor = state.teams.away.color;
  state = makeDefaultState();
  state.settings = settings;
  state.meta = meta;
  state.teams = { home: makeTeam(homeColor), away: makeTeam(awayColor) };
  state.clock.remaining = settings.quarterMinutes * 60;
  state.shotClock.remaining = settings.shotClockSeconds;
  endBeepPlayed = { game: false, shot: false };
  saveState();
  render();
  showToast('Nova partida pronta.');
}

function clearEvents() {
  if (!confirm('Apagar todo o histórico de acontecimentos desta partida?')) return;
  snapshotForUndo();
  state.events = [];
  saveState();
  renderEvents();
}

function openDisplay() {
  window.open('display.html', 'JBA_SCOREBOARD_DISPLAY', 'popup=yes,width=1500,height=900');
}

function tick() {
  let changed = false;
  const gameRemaining = currentValue(state.clock);
  const shotRemaining = currentValue(state.shotClock);
  const timeoutRemaining = currentValue(state.timeoutClock);

  if (state.clock.running && gameRemaining <= 0) {
    state.clock.remaining = 0;
    state.clock.running = false;
    state.clock.deadline = null;
    pauseTimer(state.shotClock);
    if (!endBeepPlayed.game) { beep(660, 0.55); endBeepPlayed.game = true; }
    pushEvent(`Tempo encerrado no ${periodName()}.`, null, 'clock');
    changed = true;
  }
  if (state.shotClock.running && shotRemaining <= 0) {
    state.shotClock.remaining = 0;
    state.shotClock.running = false;
    state.shotClock.deadline = null;
    if (!endBeepPlayed.shot) { beep(1040, 0.22); endBeepPlayed.shot = true; }
    changed = true;
  }
  if (state.timeoutClock.running && timeoutRemaining <= 0) {
    state.timeoutClock.remaining = 0;
    state.timeoutClock.running = false;
    state.timeoutClock.deadline = null;
    state.timeoutClock.side = null;
    pushEvent('Tempo técnico encerrado.', null, 'timeout');
    beep(740, 0.3);
    changed = true;
  }
  renderLiveClocks();
  if (changed) {
    saveState();
    renderEvents();
  }
}

function bindEvents() {
  $('#saveMetaBtn').addEventListener('click', saveMatchMeta);
  ['competitionInput', 'categoryInput', 'venueInput', 'dateInput'].forEach((id) => {
    $(`#${id}`).addEventListener('change', saveMatchMeta);
  });
  $('#homeTeamSelect').addEventListener('change', (event) => changeTeamColor('home', event.target.value));
  $('#awayTeamSelect').addEventListener('change', (event) => changeTeamColor('away', event.target.value));

  $('#toggleGameClock').addEventListener('click', () => {
    if (state.clock.running) {
      snapshotForUndo();
      pauseGameClocks();
      pushEvent('Relógio de jogo pausado.', null, 'clock');
    } else {
      if (state.finished) return showToast('A partida terminou. Inicie uma nova partida.');
      if (currentValue(state.clock) <= 0) return showToast('O relógio está zerado. Reinicie ou avance o período.');
      snapshotForUndo();
      startTimer(state.clock);
      state.started = true;
      endBeepPlayed.game = false;
      pushEvent('Relógio de jogo iniciado.', null, 'clock');
    }
    saveState();
    renderScoreboard();
    renderEvents();
  });
  $('#resetGameClock').addEventListener('click', resetGameClock);
  $$('[data-adjust-clock]').forEach((button) => button.addEventListener('click', () => adjustGameClock(Number(button.dataset.adjustClock))));
  $('#shot24Btn').addEventListener('click', () => resetShotClock(24));
  $('#shot14Btn').addEventListener('click', () => resetShotClock(14));
  $('#shotToggleBtn').addEventListener('click', () => {
    if (state.shotClock.running) pauseTimer(state.shotClock);
    else {
      if (!state.clock.running) return showToast('Inicie o tempo de jogo antes do relógio de arremesso.');
      if (!startTimer(state.shotClock)) return showToast('Ajuste o relógio para 24 ou 14 segundos.');
      endBeepPlayed.shot = false;
    }
    saveState();
    renderScoreboard();
  });
  $('#shotStopBtn').addEventListener('click', () => { pauseTimer(state.shotClock); saveState(); renderScoreboard(); });

  $$('[data-score-side]').forEach((button) => button.addEventListener('click', () => registerPoints(button.dataset.scoreSide, Number(button.dataset.points))));
  $$('[data-team-foul]').forEach((button) => button.addEventListener('click', () => addTeamFoul(button.dataset.teamFoul)));
  $$('[data-timeout]').forEach((button) => button.addEventListener('click', () => registerTimeout(button.dataset.timeout)));
  $('#possessionHome').addEventListener('click', () => changePossession('home'));
  $('#possessionAway').addEventListener('click', () => changePossession('away'));

  $('#nextPeriodBtn').addEventListener('click', () => changePeriod(1));
  $('#previousPeriodBtn').addEventListener('click', () => changePeriod(-1));
  $('#undoBtn').addEventListener('click', undoLastAction);
  $('#endTimeoutBtn').addEventListener('click', finishTimeout);
  $('#clearEventsBtn').addEventListener('click', clearEvents);
  $('#settingsForm').addEventListener('submit', (event) => { event.preventDefault(); saveSettings(event.currentTarget); });
  $('#restoreDefaultsBtn').addEventListener('click', restoreDefaults);
  $('#exportJsonBtn').addEventListener('click', exportBackup);
  $('#importJsonInput').addEventListener('change', (event) => { const file = event.target.files[0]; if (file) importBackup(file); event.target.value = ''; });
  $('#newMatchBtn').addEventListener('click', newMatch);
  $('#openDisplayBtn').addEventListener('click', openDisplay);
  $('#fullscreenBtn').addEventListener('click', () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => showToast('Não foi possível ativar tela cheia.'));
    else document.exitFullscreen?.();
  });
}

bindEvents();
render();
saveState();
window.setInterval(tick, 50);
window.addEventListener('beforeunload', saveState);
window.addEventListener('storage', (event) => {
  if (event.key !== STORAGE_KEY || !event.newValue) return;
  try { state = mergeState(JSON.parse(event.newValue)); render(); } catch (_) { /* ignora estado inválido */ }
});
if (channel) channel.addEventListener('message', () => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) { state = mergeState(JSON.parse(saved)); render(); }
  } catch (_) { /* mantém o estado aberto */ }
});
