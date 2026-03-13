// Phase 4 (minimal) — deterministic probe engine
// Non-goals: transport/network/LLM/persistence/state mutation.

import { validateSafeShortText } from '../../phase2/body/safeText.mjs';

// Output content is fixed and MUST NOT be freely generated.
export const PROBE_ENGINE_QUESTION_1 = 'What are you trying to accomplish in this session?';
export const PROBE_ENGINE_QUESTION_2 = 'What constraints should we follow while probing?';
export const PROBE_ENGINE_SUMMARY_TEXT = 'Probe complete.';

const QUESTION_SET = [PROBE_ENGINE_QUESTION_1, PROBE_ENGINE_QUESTION_2];

const COMPLETION_ROUNDS = 2;

function isPlainObject(x) {
  return !!x && typeof x === 'object' && (x.constructor === Object || Object.getPrototypeOf(x) === null);
}

function assertTranscript(transcript) {
  if (!Array.isArray(transcript)) throw new Error('probeEngine: transcript must be an array');

  for (let i = 0; i < transcript.length; i++) {
    const e = transcript[i];
    if (!isPlainObject(e)) throw new Error(`probeEngine: transcript[${i}] must be an object`);
    if (typeof e.type !== 'string') throw new Error(`probeEngine: transcript[${i}].type must be string`);
    if (!('body' in e)) throw new Error(`probeEngine: transcript[${i}].body missing`);
    if (!isPlainObject(e.body)) throw new Error(`probeEngine: transcript[${i}].body must be object`);

    if (e.type === 'probe.question') {
      validateSafeShortText(`transcript[${i}].body.q`, e.body.q);
    } else if (e.type === 'probe.answer') {
      validateSafeShortText(`transcript[${i}].body.a`, e.body.a);
    } else if (e.type === 'probe.summary') {
      validateSafeShortText(`transcript[${i}].body.summary`, e.body.summary);
    } else if (e.type === 'probe.done') {
      if (e.body.done !== true) throw new Error(`probeEngine: transcript[${i}].body.done must be true`);
    } else {
      throw new Error(`probeEngine: unsupported transcript event type: ${e.type}`);
    }
  }
}

function analyzeSequence(transcript) {
  // Transcript grammar (minimal):
  // question -> answer -> question -> answer -> summary -> done
  // Disallowed examples: answer-start, question-question, answer-answer, summary->question, summary->summary, done->anything.
  // Returns { rounds, hasSummary, hasDone }
  let rounds = 0;
  let expecting = 'question_or_summary_or_done';
  let hasSummary = false;
  let hasDone = false;

  for (let i = 0; i < transcript.length; i++) {
    const t = transcript[i].type;

    if (hasDone) {
      throw new Error('probeEngine: unsupported sequence (events after probe.done)');
    }

    if (t === 'probe.question') {
      if (hasSummary) {
        throw new Error('probeEngine: unsupported sequence (probe.question after probe.summary)');
      }
      if (expecting !== 'question_or_summary_or_done') {
        throw new Error('probeEngine: unsupported sequence (unexpected probe.question)');
      }
      expecting = 'answer';
      continue;
    }

    if (t === 'probe.answer') {
      if (hasSummary) {
        throw new Error('probeEngine: unsupported sequence (probe.answer after probe.summary)');
      }
      if (expecting !== 'answer') {
        throw new Error('probeEngine: unsupported sequence (unexpected probe.answer)');
      }
      rounds += 1;
      expecting = 'question_or_summary_or_done';
      continue;
    }

    if (t === 'probe.summary') {
      if (expecting !== 'question_or_summary_or_done') {
        throw new Error('probeEngine: unsupported sequence (probe.summary while awaiting answer)');
      }
      if (hasSummary) throw new Error('probeEngine: unsupported sequence (duplicate probe.summary)');
      hasSummary = true;
      continue;
    }

    if (t === 'probe.done') {
      if (expecting !== 'question_or_summary_or_done') {
        throw new Error('probeEngine: unsupported sequence (probe.done while awaiting answer)');
      }
      if (!hasSummary) {
        throw new Error('probeEngine: unsupported sequence (probe.done before probe.summary)');
      }
      hasDone = true;
      continue;
    }

    throw new Error(`probeEngine: unsupported sequence token: ${t}`);
  }

  if (expecting === 'answer') {
    throw new Error('probeEngine: unsupported sequence (dangling probe.question without answer)');
  }

  return { rounds, hasSummary, hasDone };
}

export const probeEngine = {
  /**
   * @param {object} args
   * @param {object} args.state Phase 2 session state snapshot
   * @param {Array} args.transcript Local-only probe transcript events
   */
  next({ state, transcript }) {
    if (!state || typeof state !== 'object') throw new Error('probeEngine: missing state');
    if (state.state !== 'PROBING') return null;

    assertTranscript(transcript);
    const { rounds, hasSummary, hasDone } = analyzeSequence(transcript);

    // Completion rule (minimal + deterministic):
    // - After COMPLETION_ROUNDS valid Q/A rounds: emit probe.summary
    // - After probe.summary: emit probe.done
    // - After probe.done: return null

    if (hasDone) return null;

    if (hasSummary) {
      return { type: 'probe.done', body: { done: true } };
    }

    if (rounds >= COMPLETION_ROUNDS) {
      return { type: 'probe.summary', body: { summary: PROBE_ENGINE_SUMMARY_TEXT } };
    }

    // Next question is deterministic by round index (fixed set; no free generation).
    const q = QUESTION_SET[rounds];
    if (!q) throw new Error('probeEngine: no fixed question available for this round');
    return { type: 'probe.question', body: { q } };
  }
};

export const PROBE_ENGINE_COMPLETION_RULE = {
  kind: 'fixed_rounds_then_summary_then_done',
  completion_rounds: COMPLETION_ROUNDS
};
