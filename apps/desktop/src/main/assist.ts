import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'

export type AssistTask = 'rewrite' | 'note'

/** `present`: the helper is on this machine. `available`: the model behind it can answer now. */
export type AssistState = { present: boolean; available: boolean; reason: string }

const ONLY = 'Answer with that text only: no quotation marks around it, no explanation, no heading.'

/** What to ask the model. The helper only carries the question, so the wording lives here. */
export function assistRequest(task: AssistTask, passage: string, note: string): { instructions: string; prompt: string } {
  const asked = note.trim()
  if (task === 'rewrite') {
    return {
      instructions: [
        'You are an editor. Rewrite the passage you are given so that it is clearer and plainer.',
        'Keep its meaning, its language, and its markdown. Add nothing that is not in it.',
        asked && `The reviewer asks for this: ${asked}`,
        ONLY
      ]
        .filter(Boolean)
        .join('\n'),
      prompt: passage
    }
  }
  return {
    instructions: [
      'You are reviewing a draft. Write one short comment to its author about the passage you are given.',
      asked
        ? `The reviewer noted this in a hurry: ${asked}\nWrite it out as one clear comment.`
        : 'Say what is unclear, missing, or should change, and why.',
      'One or two sentences, in the language of the passage.',
      ONLY
    ].join('\n'),
    prompt: passage
  }
}

/** Run the native helper once. It answers with one line of JSON and always exits cleanly. */
function ask(helper: string, args: string[], input: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const child = execFile(helper, args, { timeout: 60_000, maxBuffer: 1 << 20 }, (error, stdout) => {
      if (error) return reject(new Error('The assist did not answer.'))
      try {
        resolve(JSON.parse(stdout) as Record<string, unknown>)
      } catch {
        reject(new Error('The assist gave an answer that could not be read.'))
      }
    })
    child.stdin?.on('error', () => {})
    child.stdin?.end(input)
  })
}

export async function checkNativeAssist(helper: string): Promise<AssistState> {
  if (!existsSync(helper)) return { present: false, available: false, reason: '' }
  try {
    const answer = await ask(helper, ['--check'], '')
    return { present: true, available: answer.available === true, reason: String(answer.reason ?? '') }
  } catch (caught) {
    return { present: true, available: false, reason: (caught as Error).message }
  }
}

const plain = (text: string): string => text.trim().replace(/^["“]([\s\S]*)["”]$/, '$1').trim()

/** The native model's text, for the reader to accept or change. Nothing here touches a file. */
export async function runNativeAssist(helper: string, task: AssistTask, passage: string, note: string): Promise<string> {
  if (!passage.trim()) throw new Error('Select a passage first.')
  const answer = await ask(helper, [], JSON.stringify(assistRequest(task, passage, note)))
  if (typeof answer.text !== 'string') throw new Error(String(answer.error ?? 'The assist gave no text.'))
  // A small model likes to wrap what it writes in quotation marks, whatever it is told.
  return plain(answer.text)
}

const OLLAMA = 'http://127.0.0.1:11434'
const MODEL = process.env.MATE_OLLAMA_MODEL || 'qwen2.5:3b'

export async function checkOllamaAssist(url = OLLAMA, model = MODEL): Promise<AssistState> {
  try {
    const answer = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(1500) })
    if (!answer.ok) throw new Error()
    const tags = (await answer.json()) as { models?: { name?: string }[] }
    if ((tags.models ?? []).some((each) => each.name === model || each.name?.startsWith(`${model}:`))) {
      return { present: true, available: true, reason: '' }
    }
    return { present: true, available: false, reason: `Writing assist needs the ${model} model in Ollama. In a terminal: ollama pull ${model}` }
  } catch {
    return { present: true, available: false, reason: `Writing assist needs Ollama running on this computer, with the ${model} model.` }
  }
}

export async function runOllamaAssist(task: AssistTask, passage: string, note: string, url = OLLAMA, model = MODEL): Promise<string> {
  if (!passage.trim()) throw new Error('Select a passage first.')
  const request = assistRequest(task, passage, note)
  let answer: Response
  try {
    answer = await fetch(`${url}/api/chat`, {
      method: 'POST',
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          { role: 'system', content: request.instructions },
          { role: 'user', content: request.prompt }
        ]
      }),
      signal: AbortSignal.timeout(120_000)
    })
  } catch {
    throw new Error('Ollama did not answer the assist.')
  }
  if (!answer.ok) throw new Error(`Ollama did not answer the assist: ${answer.status}`)
  const reply = (await answer.json()) as { message?: { content?: unknown }; error?: unknown }
  if (typeof reply.message?.content !== 'string') throw new Error(String(reply.error ?? 'Ollama gave the assist no text.'))
  return plain(reply.message.content)
}

export function checkAssist(helper: string): Promise<AssistState> {
  return process.platform === 'linux' ? checkOllamaAssist() : checkNativeAssist(helper)
}

export function runAssist(helper: string, task: AssistTask, passage: string, note: string): Promise<string> {
  return process.platform === 'linux' ? runOllamaAssist(task, passage, note) : runNativeAssist(helper, task, passage, note)
}
