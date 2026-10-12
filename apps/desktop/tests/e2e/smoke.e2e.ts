import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { launch } from './drive.ts'

const names = (selector: string) =>
  `[...document.querySelectorAll(${JSON.stringify(selector)})].map((each) => each.textContent + (each.classList.contains('active') ? '*' : ''))`

test('the window, on the example context: a comment into the file, the tree, a pane, the conversation on the page', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mate-e2e-'))
  const context = path.join(root, 'example')
  await cp(path.resolve(import.meta.dirname, '../../../../contexts/_example'), context, { recursive: true })
  const project = path.join(context, 'projects/document-review')
  const app = await launch(context)
  try {
    // The folder on the command line is the open context. No folder dialog is involved.
    await app.until(`document.querySelector('.rail h2')?.textContent === 'example'`, 'the context is open')
    await app.press('.rail .row', 'document-review')
    await app.until(`document.querySelectorAll('.rail .tree .row').length > 0`, 'the project is open')
    assert.deepEqual(await app.page(names('.margin .tabs button')), ['Review*', 'Agent', 'tasks'])
    // Every file of the project is in the tree, those in folded folders too. The draft is the one on the page.
    assert.deepEqual(
      (await app.page<string[]>(names('.rail .tree .row'))).sort(),
      ['README.md', 'README.md', 'document.md*', 'intents.md', 'principles.md', 'tasks.md']
    )

    // Select a passage, comment on it, and find the comment in the file under the passage.
    const passage = 'The shelf copy stays as it was until you publish.'
    await app.page(`(() => {
      const page = document.querySelector('.page')
      const walker = document.createTreeWalker(page, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const at = node.data.indexOf(${JSON.stringify(passage)})
        if (at < 0) continue
        const range = document.createRange()
        range.setStart(node, at)
        range.setEnd(node, at + ${passage.length})
        getSelection().removeAllRanges()
        getSelection().addRange(range)
        page.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
        return true
      }
      throw new Error('The passage is not on the page.')
    })()`)
    await app.until(`!!document.querySelector('.popover.menu')`, 'the menu under the selection')
    await app.press('.popover.menu button', 'Comment')
    await app.until(`!!document.querySelector('.composer textarea[aria-label="Note"]')`, 'the form for the note')
    await app.page(`(() => {
      const note = document.querySelector('.composer textarea[aria-label="Note"]')
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(note, 'Said by the test.')
      note.dispatchEvent(new Event('input', { bubbles: true }))
    })()`)
    await app.press('.composer footer button', 'Add to the file')
    await app.until(`document.querySelectorAll('.thread').length === 2`, 'the new thread in the margin')
    const draft = (await readFile(path.join(project, 'draft/document.md'), 'utf8')).split('\n')
    assert.match(draft[draft.indexOf(passage) + 1], /^<!-- @comment\{.*"text":"Said by the test\.".*\} -->$/)

    // Type in the draft. The file gets the new text, and each comment stays under its passage.
    await app.press('.center .bar button', 'Edit')
    await app.until(`!!document.querySelector('textarea.editor')`, 'the editor on the page')
    await app.page(`(() => {
      const editor = document.querySelector('textarea.editor')
      const text = editor.value.replace('Replace this text with the copy.', 'Replace this text with the copy, soon.') + '\\nA line typed in the window.\\n'
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(editor, text)
      editor.dispatchEvent(new Event('input', { bubbles: true }))
    })()`)
    await app.press('.center .bar button', 'Save')
    await app.until(`[...document.querySelectorAll('.center .bar button')].find((each) => each.textContent === 'Save')?.disabled === true`, 'the draft is saved')
    const typed = (await readFile(path.join(project, 'draft/document.md'), 'utf8')).split('\n')
    assert.ok(typed.includes('A line typed in the window.'))
    assert.ok(typed.some((line) => line.startsWith('Replace this text with the copy, soon.')))
    assert.match(typed[typed.indexOf(passage) + 1], /Said by the test/)
    await app.press('.center .bar button', 'Done')
    await app.until(`document.querySelector('.page.prose')?.textContent.includes('A line typed in the window.')`, 'the page shows what was typed')
    assert.equal(await app.page(`document.querySelectorAll('.thread').length`), 2)

    // A new draft is a file with its title, open to be written. Then back to the first one.
    await app.press('.tree-new .row', '+ New draft')
    await app.page(`(() => {
      const input = document.querySelector('.tree-new input')
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Second draft')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.form.requestSubmit()
    })()`)
    await app.until(`document.querySelector('textarea.editor')?.value === '# Second draft\\n'`, 'the new draft, open to be written')
    assert.equal(await readFile(path.join(project, 'draft/Second draft.md'), 'utf8'), '# Second draft\n')
    await app.press('.rail .tree .row', 'document.md')
    await app.until(`document.querySelector('.center .bar').textContent.includes('document.md')`, 'the first draft again')

    // Another file of the project is read on the page, and the project stays open beside it.
    await app.press('.rail .tree .row', 'intents.md')
    await app.until(`document.querySelector('.center .bar').textContent.includes('intents.md')`, 'the file on the page')
    assert.deepEqual(await app.page(names('.margin .tabs button')), ['Review*', 'Agent', 'tasks'])

    // A pane is a tab of the margin. One that is written while the project is open is put on show.
    await app.press('.margin .tabs button', 'tasks')
    await app.until(`document.querySelector('.margin .pane h1')?.textContent.includes('Tasks')`, 'the pane in the margin')
    await writeFile(path.join(project, 'panes/deadlines.md'), '# Deadlines\n\n- 20 October: legal\n')
    await app.page(`window.dispatchEvent(new Event('focus'))`)
    await app.until(`document.querySelector('.margin .pane h1')?.textContent.includes('Deadlines')`, 'the new pane on show')
    assert.deepEqual(await app.page(names('.margin .tabs button')), ['Review', 'Agent', 'deadlines*', 'tasks'])

    // The conversation with the agent can have the page. Nothing is trusted, and no agent is started here.
    await app.press('.margin .tabs button', 'Agent')
    await app.until(`!!document.querySelector('.margin .invite')`, 'the agents to invite')
    assert.match(await app.page<string>(`document.querySelector('.trust').textContent`), /This context is not trusted/)
    await app.press('.talk-move button', 'Open in the page')
    await app.until(`!!document.querySelector('.center .talk-page .invite')`, 'the conversation on the page')
    assert.deepEqual(await app.page(names('.margin .tabs button')), ['Review', 'deadlines*', 'tasks'])

    // The app kept its own data in the folder it was given, not in the reader's.
    assert.ok((await readdir(app.userData)).length > 0)
    assert.equal(existsSync(path.join(app.userData, 'trusted.json')), false)
  } finally {
    await app.close()
    await rm(root, { recursive: true, force: true })
  }
})
