'use strict';
const KEY = 'jba-scoreboard-v2';
const $ = (selector) => document.querySelector(selector);
const TEAM_NAMES = { preto: 'PRETO', amarelo: 'AMARELO', verde: 'VERDE', azul: 'AZUL' };

function load() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); }
  catch (_) { return null; }
}
function timeLeft(timer) {
  if (!timer) return 0;
  if (timer.running && Number.isFinite(timer.deadline)) return Math.max(0, (timer.deadline - Date.now()) / 1000);
  return Math.max(0, Number(timer.remaining) || 0);
}
function gameFormat(seconds) {
  const value = Math.max(0, seconds);
  if (value < 60) return `${String(Math.floor(value)).padStart(2, '0')}.${Math.floor((value % 1) * 10)}`;
  const whole = Math.ceil(value);
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
}
function shotFormat(seconds) {
  const value = Math.max(0, seconds);
  return value <= 5 && value > 0 ? value.toFixed(1) : String(Math.ceil(value));
}
function countdownFormat(seconds) {
  const whole = Math.ceil(Math.max(0, seconds));
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
}
function timeoutLeft(team, state) {
  if (state.period <= 2) return Math.max(0, Number(state.settings.firstHalfTimeouts) - Number(team.timeouts?.firstHalf || 0));
  if (state.period <= 4) return Math.max(0, Number(state.settings.secondHalfTimeouts) - Number(team.timeouts?.secondHalf || 0));
  return Math.max(0, Number(state.settings.overtimeTimeouts) - Number(team.timeouts?.overtime?.[state.overtimeNumber] || 0));
}
function periodName(state) {
  return state.period <= 4 ? `${state.period}º QUARTO` : `${state.overtimeNumber || state.period - 4}ª PRORROGAÇÃO`;
}
function renderPeriodPoints(state) {
  const keys = ['1', '2', '3', '4'];
  const overtimeCount = Math.max(0, Number(state.period || 1) - 4, Number(state.overtimeNumber || 0));
  for (let i = 1; i <= overtimeCount; i += 1) keys.push(`OT${i}`);
  const columns = keys.map((key) => `<div class="period-score-col"><span>${key.startsWith('OT') ? key : `${key}Q`}</span><strong>${Number(state.teams.home.periodScores?.[key] || 0)}</strong><strong>${Number(state.teams.away.periodScores?.[key] || 0)}</strong></div>`).join('');
  $('#periodPoints').innerHTML = `<span class="period-points-label">PARCIAIS</span><div class="period-score-table">${columns}<div class="period-score-col total"><span>TOTAL</span><strong>${Number(state.teams.home.score || 0)}</strong><strong>${Number(state.teams.away.score || 0)}</strong></div></div>`;
}
function update() {
  const state = load();
  if (!state || !state.teams) return;
  const home = state.teams.home;
  const away = state.teams.away;
  const homeColor = TEAM_NAMES[home.color] ? home.color : 'preto';
  const awayColor = TEAM_NAMES[away.color] ? away.color : 'amarelo';
  $('#competition').textContent = state.meta?.competition || 'CAMPEONATO JBA';
  $('#category').textContent = state.meta?.category || 'PLACAR AO VIVO';
  $('#period').textContent = periodName(state);
  const gameRemaining = timeLeft(state.clock);
  $('#status').textContent = state.finished ? 'FIM DE JOGO' : gameRemaining <= 0 ? 'TEMPO ENCERRADO' : state.clock?.running ? 'AO VIVO' : state.started ? 'JOGO PAUSADO' : 'AGUARDANDO INÍCIO';

  $('#homeTeam').dataset.color = homeColor;
  $('#awayTeam').dataset.color = awayColor;
  $('#homeDot').dataset.color = homeColor;
  $('#awayDot').dataset.color = awayColor;
  $('#homeName').textContent = TEAM_NAMES[homeColor];
  $('#awayName').textContent = TEAM_NAMES[awayColor];
  $('#homeScore').textContent = Number(home.score || 0);
  $('#awayScore').textContent = Number(away.score || 0);

  const homeFoulsKey = state.period >= 4 ? '4+' : String(state.period);
  const awayFoulsKey = state.period >= 4 ? '4+' : String(state.period);
  const homeFouls = Number(home.teamFouls?.[homeFoulsKey] || 0);
  const awayFouls = Number(away.teamFouls?.[awayFoulsKey] || 0);
  const limit = Number(state.settings?.teamFoulLimit || 4);
  $('#homeFouls').textContent = homeFouls;
  $('#awayFouls').textContent = awayFouls;
  $('#homeFouls').classList.toggle('penalty', homeFouls >= limit);
  $('#awayFouls').classList.toggle('penalty', awayFouls >= limit);
  $('#homeTimeouts').textContent = timeoutLeft(home, state);
  $('#awayTimeouts').textContent = timeoutLeft(away, state);
  $('#homePossession').classList.toggle('active', state.possession === 'home');
  $('#awayPossession').classList.toggle('active', state.possession === 'away');

  $('#gameClock').textContent = gameFormat(gameRemaining);
  $('#shotClock').textContent = shotFormat(timeLeft(state.shotClock));
  $('#gameClock').classList.toggle('zero', gameRemaining <= 0);
  $('#shotClock').classList.toggle('zero', timeLeft(state.shotClock) <= 0);
  const timeoutRemaining = timeLeft(state.timeoutClock);
  $('#timeoutBanner').hidden = timeoutRemaining <= 0;
  $('#timeoutClock').textContent = countdownFormat(timeoutRemaining);
  $('#venue').textContent = state.meta?.venue || '';
  $('#matchDate').textContent = state.meta?.date || '';
  renderPeriodPoints(state);
}

$('#fullscreenBtn').addEventListener('click', () => {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
  else document.exitFullscreen?.();
});
window.addEventListener('storage', (event) => { if (event.key === KEY) update(); });
if ('BroadcastChannel' in window) {
  const channel = new BroadcastChannel('jba-scoreboard-sync');
  channel.addEventListener('message', update);
}
update();
window.setInterval(update, 60);
