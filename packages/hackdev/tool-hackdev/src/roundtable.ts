/**
 * The roundtable script: several agents think about one question together and talk until they agree, in the manner
 * of a multi-agent "heavy" mode. A captain leads; specialists each take a different angle (facts and evidence;
 * logic, math and code; the contrary view), and with more agents each angle is staffed several times. Everything a
 * member finds or asks goes onto one shared board, addressed to `@name` or `@all`. In each round every member reads
 * what is new on the board, answers the questions put to it, supports or challenges the claims of others by post
 * number, and revises its own answer. After each round the captain reads the board, puts the open questions to the
 * right members, and calls an end once the open disagreements are settled. It then writes the final answer,
 * reporting what was agreed, how each dispute was resolved, and any dissent that remains. Members only investigate:
 * they never change the project. Like the other scripts, this runs inside the workflow engine's confined guest.
 * @module @hackdevcode/dsh-tool-hackdev/roundtable
 */

import { LIBRARY } from './script.ts'

/** Roundtable: specialists explore, talk on one board for a few rounds, and the captain writes the answer. */
export const HACKDEV_ROUNDTABLE_SCRIPT = LIBRARY + String.raw`

const POST_KINDS = ['finding', 'question', 'answer', 'support', 'challenge', 'revision']
const question = clip(args.question, 8000)
const notes = isText(args.notes) ? clip(args.notes.trim(), 2000) : ''
const maxRounds = Number.isInteger(args.rounds) && args.rounds > 0 ? Math.min(args.rounds, 4) : 3
const memberCount = Number.isInteger(args.agents) && args.agents >= 2 ? Math.min(args.agents, 16) : 4

// ------------------------------------------------------------------ Roster
const ANGLES = [
  {
    id: 'researcher',
    brief: 'Facts and evidence. Find out what is actually true: read the project files and code, search them, and use web search or fetch when the question needs outside facts. Back every factual claim with its source (path:line, a command and its output, or a URL). Flag claims on the board that you find unsupported.',
  },
  {
    id: 'logician',
    brief: 'Logic, math and code. Work the problem through step by step: check each inference and calculation, and where the question involves code, read it and run small commands or tests to see how it really behaves. Point out reasoning on the board that does not follow.',
  },
  {
    id: 'contrarian',
    brief: 'The contrary view. Look for what the others miss: hidden assumptions, edge cases, failure modes, risks and better alternatives. Argue the strongest opposing case on the board, but concede a point as soon as evidence settles it; your job is to make the answer right, not to win.',
  },
]
const roster = [{ name: 'captain', angle: 'captain', brief: '', session: 'roundtable:captain' }]
for (let i = 0; roster.length < memberCount; i++) {
  const angle = ANGLES[i % ANGLES.length]
  const copy = Math.floor(i / ANGLES.length) + 1
  const name = copy === 1 ? angle.id : angle.id + '-' + copy
  roster.push({ name: name, angle: angle.id, brief: angle.brief, session: 'roundtable:' + name })
}
const specialists = roster.slice(1)
function isMember(name) { return roster.some(function (m) { return m.name === name }) }

// ------------------------------------------------------------------ Board
const board = []
const shownUpTo = {}

function addressee(raw) {
  let name = String(raw).trim().toLowerCase()
  while (name.charAt(0) === '@') name = name.slice(1)
  return name === 'all' || isMember(name) ? name : 'captain'
}

function post(from, to, kind, text, ref, round) {
  if (!isText(text)) return
  const list = unique((Array.isArray(to) ? to : [to]).map(addressee))
  const entry = {
    n: board.length + 1,
    round: round,
    from: from,
    to: list.length === 0 ? ['all'] : list,
    kind: POST_KINDS.indexOf(kind) >= 0 ? kind : 'finding',
    ref: Number.isInteger(ref) && ref > 0 && ref <= board.length ? ref : null,
    text: clip(text.trim(), 700),
  }
  board.push(entry)
  log('[board #' + entry.n + '] @' + from + ' -> ' + entry.to.map(function (t) { return '@' + t }).join(' ') + ' (' + entry.kind + (entry.ref === null ? '' : ' on #' + entry.ref) + '): ' + clip(entry.text, 160))
}

function addPosts(from, posts, round) {
  if (!Array.isArray(posts)) return
  for (const p of posts.slice(0, 10)) {
    if (p === null || typeof p !== 'object' || !isText(p.text)) continue
    post(from, isText(p.to) ? p.to.split(/[\s,]+/).filter(isText) : ['all'], p.kind, p.text, p.ref, round)
  }
}

function line(e) {
  return '#' + e.n + ' [round ' + e.round + '] @' + e.from + ' -> ' + e.to.map(function (t) { return '@' + t }).join(' ') + ' (' + e.kind + (e.ref === null ? '' : ' on #' + e.ref) + '): ' + e.text
}

/** The board as one member reads it: posts to it first, then the rest, newest kept when the budget runs out. */
function boardFor(name, from) {
  const entries = board.slice(from)
  if (entries.length === 0) return '(nothing new on the board)'
  const budget = typeof args.maxMemoryChars === 'number' ? args.maxMemoryChars : 12000
  const mine = entries.filter(function (e) { return e.to.indexOf(name) >= 0 })
  const rest = entries.filter(function (e) { return e.to.indexOf(name) < 0 })
  const pick = function (list, limit) {
    const out = []
    let used = 0
    for (let i = list.length - 1; i >= 0; i--) {
      const l = line(list[i])
      if (used + l.length > limit) break
      used += l.length + 1
      out.unshift(l)
    }
    return { lines: out, used: used }
  }
  const a = pick(mine, Math.floor(budget / 2))
  const b = pick(rest, budget - a.used)
  const parts = []
  if (a.lines.length > 0) parts.push('Posts addressed to you:\n' + a.lines.join('\n'))
  if (b.lines.length > 0) parts.push('Other posts:\n' + b.lines.join('\n'))
  return parts.join('\n\n')
}

const postSchema = {
  type: 'object',
  properties: {
    to: { type: 'string' },
    kind: { type: 'string', enum: POST_KINDS },
    ref: { type: 'integer' },
    text: { type: 'string' },
  },
  required: ['to', 'kind', 'text'],
  additionalProperties: false,
}
const memberSchema = {
  type: 'object',
  properties: {
    answer: { type: 'string' },
    confidence: { type: 'number' },
    posts: { type: 'array', items: postSchema },
  },
  required: ['answer', 'confidence', 'posts'],
  additionalProperties: false,
}
const steerSchema = {
  type: 'object',
  properties: {
    consensus: { type: 'boolean' },
    summary: { type: 'string' },
    posts: { type: 'array', items: postSchema },
  },
  required: ['consensus', 'summary', 'posts'],
  additionalProperties: false,
}
const finalSchema = {
  type: 'object',
  properties: {
    answer: { type: 'string' },
    confidence: { type: 'number' },
    agreed: { type: 'array', items: { type: 'string' } },
    disputes: {
      type: 'array',
      items: {
        type: 'object',
        properties: { topic: { type: 'string' }, resolution: { type: 'string' } },
        required: ['topic', 'resolution'],
        additionalProperties: false,
      },
    },
    dissent: { type: 'array', items: { type: 'string' } },
    openQuestions: { type: 'array', items: { type: 'string' } },
  },
  required: ['answer', 'confidence', 'agreed', 'disputes', 'dissent', 'openQuestions'],
  additionalProperties: false,
}

const PROTOCOL = [
  'Roundtable protocol: the roundtable has ONE shared board and no private messages. Each post has to (a member name such as researcher, logician, contrarian, captain, or all), kind, an optional ref (the number of the post it is about) and a short text.',
  '- finding: something you established, with its evidence. question: something you need another member to check. answer: your reply to a question addressed to you (ref it). support or challenge: your verdict on another member\'s claim, with the reason (ref it). revision: you changed your own answer, and why.',
  '- Answer every question addressed to you. Challenge a claim only with a concrete reason, and support one only when you checked it. Do not repeat what is already on the board.',
  '- You investigate only: read files, search, run read-only commands and look things up, but never create, edit or delete project files.',
  '- answer is your current full answer to the question; confidence is 0 to 1.',
].join('\n')

function rosterText() {
  return 'Members: ' + roster.map(function (m) { return '@' + m.name + ' (' + (m.angle === 'captain' ? 'leads and writes the final answer' : m.angle) + ')' }).join(', ')
}

function memberPrompt(m, round) {
  const from = shownUpTo[m.name] || 0
  shownUpTo[m.name] = board.length
  if (round === 1) {
    return [
      'You are @' + m.name + ' on a roundtable of agents that answer one question together by sharing what they find and challenging each other until they agree.',
      'Question:\n' + question,
      notes.length > 0 ? 'Notes from the person:\n' + notes : '',
      'Your angle: ' + m.brief,
      rosterText(),
      PROTOCOL,
      GROUNDING,
      'Round 1: investigate from your angle, then post your findings and the questions you want others to check, and give your first answer.',
    ].filter(isText).join('\n\n')
  }
  return [
    'Round ' + round + ' of the roundtable. What is new on the board since you last looked:',
    boardFor(m.name, from),
    'Answer the questions addressed to you, support or challenge the claims you have checked (by post number), and revise your answer where the board changed your mind. Keep to your angle: ' + m.brief,
  ].join('\n\n')
}

// ------------------------------------------------------------------ Rounds
const answers = {}
const limit = makeLimiter(typeof args.maxParallel === 'number' && args.maxParallel > 0 ? args.maxParallel : 4)

async function runMember(m, round) {
  const options = forRole('builder', { label: 'Roundtable: @' + m.name + ' (round ' + round + ')', phase: round === 1 ? 'Explore' : 'Discuss', schema: memberSchema, session: m.session })
  let raw = null
  try {
    raw = await limit(function () { return agent(memberPrompt(m, round), options) })
  } catch (error) {
    log('@' + m.name + ' failed in round ' + round + ': ' + String(error && error.message ? error.message : error))
  }
  if (raw === null || typeof raw !== 'object') {
    post('captain', ['all'], 'finding', '@' + m.name + ' returned nothing in round ' + round + '.', null, round)
    return
  }
  const confidence = typeof raw.confidence === 'number' && raw.confidence >= 0 && raw.confidence <= 1 ? raw.confidence : 0.5
  const changed = answers[m.name] !== undefined && answers[m.name].answer !== raw.answer
  answers[m.name] = { answer: clip(raw.answer, 3000), confidence: confidence }
  addPosts(m.name, raw.posts, round)
  if (round > 1 && changed) post(m.name, ['all'], 'revision', 'Revised answer (confidence ' + confidence.toFixed(2) + '): ' + clip(raw.answer, 500), null, round)
}

const captain = roster[0]
let rounds = 0
let consensus = false
const summaries = []
for (let round = 1; round <= maxRounds; round++) {
  rounds = round
  phase(round === 1 ? 'Explore' : 'Discuss')
  await Promise.all(specialists.map(function (m) { return runMember(m, round) }))
  if (round === maxRounds) break
  // The captain steers: puts open questions to the right members and calls an end once the disagreements are settled.
  phase('Discuss')
  const from = shownUpTo.captain || 0
  shownUpTo.captain = board.length
  const answersText = specialists.map(function (m) {
    const a = answers[m.name]
    return '@' + m.name + (a === undefined ? ': (no answer yet)' : ' (confidence ' + a.confidence.toFixed(2) + '): ' + clip(a.answer, 800))
  }).join('\n')
  const prompt = round === 1
    ? ['You are @captain, leading a roundtable of agents that answer one question together.', 'Question:\n' + question, notes.length > 0 ? 'Notes from the person:\n' + notes : '', rosterText(), PROTOCOL, GROUNDING].filter(isText).join('\n\n') + '\n\n'
    : ''
  let steer = null
  try {
    steer = await agent(prompt + 'After round ' + round + ', the board shows:\n' + boardFor('captain', from) + '\n\nCurrent answers:\n' + answersText
      + '\n\nAs captain: find where the members disagree or left a claim unchecked, and put each open point to the member best placed to settle it (a question or challenge addressed to that member). Set consensus to true only when the answers agree in substance and no challenge is left unanswered; then post nothing. summary is one or two sentences on where the discussion stands.',
    forRole('planner', { label: 'Roundtable: @captain (after round ' + round + ')', phase: 'Discuss', schema: steerSchema, session: captain.session }))
  } catch (error) {
    log('@captain could not steer after round ' + round + ': ' + String(error && error.message ? error.message : error))
  }
  if (steer !== null && typeof steer === 'object') {
    if (isText(steer.summary)) summaries.push('Round ' + round + ': ' + clip(steer.summary, 400))
    addPosts('captain', steer.posts, round)
    if (steer.consensus === true) { consensus = true; break }
  }
}

// ------------------------------------------------------------------ Synthesis
phase('Synthesize')
const finalAnswers = specialists.map(function (m) {
  const a = answers[m.name]
  return '@' + m.name + (a === undefined ? ': (no answer)' : ' (confidence ' + a.confidence.toFixed(2) + '): ' + clip(a.answer, 1500))
}).join('\n\n')
let final = null
try {
  final = await agent('The discussion is over. Write the roundtable\'s final answer to the question:\n' + question
    + '\n\nThe whole board:\n' + clip(board.map(line).join('\n'), 30000)
    + '\n\nThe members\' final answers:\n' + finalAnswers
    + '\n\nResolve every contradiction on the evidence: prefer a claim that was checked over one that was asserted, and say which way each dispute went and why. Keep the dissent that evidence did not settle. agreed lists the points everyone accepted; openQuestions lists what nobody could settle. answer is complete and stands on its own for the person who asked.',
  forRole('planner', { label: 'Roundtable: @captain (final answer)', phase: 'Synthesize', schema: finalSchema, session: captain.session }))
} catch (error) {
  log('@captain could not write the final answer: ' + String(error && error.message ? error.message : error))
}
if (final === null || typeof final !== 'object' || !isText(final.answer)) {
  // Without a captain's answer, the most confident member answer stands, and the report says so.
  const best = specialists.map(function (m) { return Object.assign({ name: m.name }, answers[m.name] || { answer: '', confidence: 0 }) })
    .sort(function (x, y) { return y.confidence - x.confidence })[0]
  final = {
    answer: best !== undefined && isText(best.answer) ? best.answer + '\n\n(The captain did not write a synthesis; this is the most confident member answer, from @' + best.name + '.)' : 'The roundtable produced no answer.',
    confidence: best !== undefined ? best.confidence : 0,
    agreed: [], disputes: [], dissent: [], openQuestions: [],
  }
}

return {
  kind: 'roundtable',
  question: question,
  answer: clip(final.answer, 12000),
  confidence: typeof final.confidence === 'number' ? Math.max(0, Math.min(1, final.confidence)) : 0.5,
  consensus: consensus,
  agreed: textList(final.agreed).map(function (s) { return clip(s, 400) }).slice(0, 20),
  disputes: (Array.isArray(final.disputes) ? final.disputes : []).filter(function (d) { return d !== null && typeof d === 'object' && isText(d.topic) })
    .map(function (d) { return { topic: clip(d.topic, 300), resolution: clip(d.resolution, 600) } }).slice(0, 20),
  dissent: textList(final.dissent).map(function (s) { return clip(s, 400) }).slice(0, 10),
  openQuestions: textList(final.openQuestions).map(function (s) { return clip(s, 400) }).slice(0, 10),
  rounds: rounds,
  summaries: summaries,
  members: roster.map(function (m) {
    const a = answers[m.name]
    return { name: m.name, angle: m.angle, confidence: a === undefined ? null : a.confidence }
  }),
  posts: board.length,
  board: board.slice(-200),
}
`

/** Meta identity block for the engine's validation and progress UI. */
export const HACKDEV_ROUNDTABLE_META = {
  name: 'hackdev-roundtable',
  description: 'Several agents share findings on one board, challenge each other over a few rounds, and a captain writes the agreed answer.',
  phases: [
    { title: 'Explore', detail: 'Each specialist investigates from its own angle and posts findings and questions.' },
    { title: 'Discuss', detail: 'Members answer each other, support or challenge claims by post number, and revise; the captain puts open points to the right member.' },
    { title: 'Synthesize', detail: 'The captain resolves the disputes on the evidence and writes the final answer, with what was agreed and any dissent.' },
  ],
}
