import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { cp, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
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
    await app.until(`document.querySelectorAll('.projects .tree .row').length > 0`, 'the project is open')
    assert.deepEqual(await app.page(names('.margin .tabs button')), ['Review*', 'Agent', 'tasks', 'workflow'])
    // Every file of the project is in the tree, those in folded folders too. The draft is the one on the page.
    assert.deepEqual(
      (await app.page<string[]>(names('.projects .tree .row'))).sort(),
      ['README.md', 'README.md', 'count-words.py', 'document.md*', 'intents.md', 'principles.md', 'tasks.md', 'workflow.md']
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
    await app.press('.projects .tree .row', 'document.md')
    await app.until(`document.querySelector('.center .bar').textContent.includes('document.md')`, 'the first draft again')

    // Publishing asks for a name on the shelf, and offers the ones that are there. The system asks once more, so it stops here.
    await app.press('.center .bar button', 'Publish…')
    await app.until(`document.querySelector('.publish input')?.value === 'document.md'`, 'the name to publish under')
    assert.deepEqual(await app.page(`[...document.querySelectorAll('#shelf-names option')].map((each) => each.value)`), ['README.md'])
    await app.press('.publish button', 'Cancel')

    // A document of the shelf is read from the rail, and taken down into the project as a draft of its own.
    await app.press('.rail .shelf .tree .row', 'README.md')
    await app.until(`document.querySelector('.center .bar').textContent.includes('shelf/README.md')`, 'the shelf document on the page')
    await app.press('.center .bar button', 'Take a copy into document-review')
    await app.until(`document.querySelector('.center .bar').textContent.includes('document-review/README.md')`, 'the copy, open as a draft')
    assert.equal(await readFile(path.join(project, 'draft/README.md'), 'utf8'), await readFile(path.join(context, 'shelf/README.md'), 'utf8'))
    // A document dropped into the project's dropbox is read there, and pulled into the drafts. It leaves the dropbox.
    await writeFile(path.join(project, 'dropbox/letter.md'), '# A letter\n\nIt came in today.\n')
    await app.page(`window.dispatchEvent(new Event('focus'))`)
    await app.until(`[...document.querySelectorAll('.projects .tree .row')].some((each) => each.textContent === 'letter.md')`, 'the file in the dropbox')
    await app.press('.projects .tree .row', 'letter.md')
    await app.until(`document.querySelector('.center .bar').textContent.includes('dropbox/letter.md')`, 'the dropped file on the page')
    await app.press('.center .bar button', 'Pull into draft/')
    await app.until(`document.querySelector('.center .bar').textContent.includes('document-review/letter.md')`, 'the file, open as a draft')
    assert.equal(existsSync(path.join(project, 'dropbox/letter.md')), false)
    assert.equal(await readFile(path.join(project, 'draft/letter.md'), 'utf8'), '# A letter\n\nIt came in today.\n')
    await app.press('.projects .tree .row', 'document.md')
    await app.until(`document.querySelector('.center .bar').textContent.includes('document.md')`, 'the first draft once more')

    // Another file of the project is read on the page, and the project stays open beside it.
    await app.press('.projects .tree .row', 'intents.md')
    await app.until(`document.querySelector('.center .bar').textContent.includes('intents.md')`, 'the file on the page')
    assert.deepEqual(await app.page(names('.margin .tabs button')), ['Review*', 'Agent', 'tasks', 'workflow'])

    // A pane is a tab of the margin. One that is written while the project is open is put on show.
    await app.press('.margin .tabs button', 'tasks')
    await app.until(`document.querySelector('.margin .pane h1')?.textContent.includes('Tasks')`, 'the pane in the margin')
    // The reader ticks a task in the pane, and the file has it ticked.
    await app.page(`[...document.querySelectorAll('.margin .pane li')].find((each) => each.textContent.includes('Mark what is unclear')).querySelector('.box').click()`)
    await app.until(`[...document.querySelectorAll('.margin .pane li')].find((each) => each.textContent.includes('Mark what is unclear')).querySelector('.box.checked') !== null`, 'the task is ticked')
    assert.match(await readFile(path.join(project, 'panes/tasks.md'), 'utf8'), /^- \[x\] Mark what is unclear$/m)
    // A line written to be said is a button, and it reads its own words. With no session open, there is nobody to say it to.
    assert.equal(await app.page(`document.querySelector('.margin .pane .say').innerText`), 'Write this pane again from the tracker')
    await app.page(`document.querySelector('.margin .pane .say').click()`)
    await app.until(`document.querySelector('.error')?.textContent.includes('Open a session with an agent first')`, 'the reader is told to open a session')
    await app.press('.invite button', 'Your own agent')
    await app.until(`!!document.querySelector('.margin .talk')`, 'a session is open')
    await app.press('.margin .tabs button', 'tasks')
    await app.page(`document.querySelector('.margin .pane .say').click()`)
    await app.until(`document.querySelector('.margin .asof + .asof')?.textContent.includes('Said to the agent')`, 'the pane says what it said')
    await app.press('.margin .tabs button', 'Agent')
    await app.until(`[...document.querySelectorAll('.said.you')].some((each) => each.textContent.trim() === 'Write this pane again from the tracker')`, 'the words are in the conversation')
    await app.press('.margin .tabs button', 'tasks')

    await writeFile(path.join(project, 'panes/deadlines.md'), '# Deadlines\n\n- 20 October: legal\n')
    await app.page(`window.dispatchEvent(new Event('focus'))`)
    await app.until(`document.querySelector('.margin .pane h1')?.textContent.includes('Deadlines')`, 'the new pane on show')
    assert.deepEqual(await app.page(names('.margin .tabs button')), ['Review', 'Agent', 'deadlines*', 'tasks', 'workflow'])

    // A file Mate cannot draw has a card with what can be done with it. Its text is taken out by the agent, when asked.
    await writeFile(path.join(project, 'dropbox/scan.pdf'), 'not a real pdf')
    await app.page(`window.dispatchEvent(new Event('focus'))`)
    await app.until(`[...document.querySelectorAll('.projects .tree .row')].some((each) => each.textContent === 'scan.pdf')`, 'the file in the tree')
    await app.press('.projects .tree .row', 'scan.pdf')
    await app.until(`document.querySelector('.source strong')?.textContent === 'scan.pdf'`, 'the card of the file')
    assert.deepEqual(await app.page(`[...document.querySelectorAll('.source .acts button')].map((each) => each.textContent.trim())`), [
      'Show it in Finder',
      'Ask the agent to extract its text into draft/',
      'Close'
    ])
    await app.press('.margin .tabs button', 'Agent')
    await app.until(`!!document.querySelector('.margin .talk')`, 'the session that is still open')
    await app.press('.source .acts button', 'Ask the agent to extract its text into draft/')
    await app.until(`[...document.querySelectorAll('.said.you')].some((each) => each.textContent.includes('Extract the text of dropbox/scan.pdf into draft/scan.md.'))`, 'the request in the conversation')
    assert.equal(await app.page(`document.querySelectorAll('.source').length`), 0)

    // The conversation with the agent can have the page. Nothing is trusted, and no agent is started here.
    await app.press('.margin .tabs button', 'Agent')
    await app.press('.margin .talk-head button', '‹ Sessions')
    await app.until(`!!document.querySelector('.margin .invite')`, 'the agents to invite')
    assert.match(await app.page<string>(`document.querySelector('.trust').textContent`), /This context is not trusted/)
    await app.press('.talk-move button', 'Open in the page')
    await app.until(`!!document.querySelector('.center .talk-page .invite')`, 'the conversation on the page')
    assert.deepEqual(await app.page(names('.margin .tabs button')), ['Review', 'deadlines*', 'tasks', 'workflow'])

    // A script is not run in a context the reader has not trusted.
    await app.press('.margin .tabs button', 'workflow')
    await app.page(`document.querySelector('.margin .pane .run').click()`)
    await app.until(`document.querySelector('.error')?.textContent.includes('only in a context you trust')`, 'the reader is told why it did not run')
    assert.equal(await app.page(`document.querySelectorAll('.ran').length`), 0)

    // The app kept its own data in the folder it was given, not in the reader's.
    assert.ok((await readdir(app.userData)).length > 0)
    assert.equal(existsSync(path.join(app.userData, 'trusted.json')), false)
  } finally {
    await app.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('in a context the reader trusts, a script of the project runs from its button, with no agent', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mate-e2e-'))
  const context = path.join(root, 'example')
  await cp(path.resolve(import.meta.dirname, '../../../../contexts/_example'), context, { recursive: true })
  // The reader trusted this folder on an earlier day: that is what the app finds in its data folder.
  const app = await launch(context, { 'trusted.json': JSON.stringify([await realpath(context)]) })
  try {
    await app.until(`document.querySelector('.rail h2')?.textContent === 'example'`, 'the context is open')
    await app.press('.rail .row', 'document-review')
    await app.until(`[...document.querySelectorAll('.margin .tabs button')].some((each) => each.textContent === 'workflow')`, 'the workflow pane')

    // The button reads the script and what it is given. Pressing it runs that, and shows what it printed.
    await app.press('.margin .tabs button', 'workflow')
    assert.equal(await app.page(`document.querySelector('.margin .pane .run').innerText`), 'scripts/count-words.py draft/document.md')
    await app.page(`document.querySelector('.margin .pane .run').click()`)
    await app.until(`!!document.querySelector('.margin .ran pre')`, 'what the script printed')
    assert.match(await app.page<string>(`document.querySelector('.margin .ran pre').textContent`), /^draft\/document\.md: \d+ words\n$/)
    assert.match(await app.page<string>(`document.querySelector('.margin .ran .meta span').textContent`), /^scripts\/count-words\.py draft\/document\.md: done, [\d.]+ s$/)

    // A script has a card of its own in the tree, and runs from there too, given nothing.
    await app.press('.projects .tree .row', 'count-words.py')
    await app.until(`document.querySelector('.source strong')?.textContent === 'count-words.py'`, 'the card of the script')
    await app.press('.source .acts button', 'Run it')
    await app.until(`!!document.querySelector('.source .ran pre')`, 'what the script printed, on its card')
    assert.match(await app.page<string>(`document.querySelector('.source .ran pre').textContent`), /^draft\/document\.md: \d+ words\n$/)
  } finally {
    await app.close()
    await rm(root, { recursive: true, force: true })
  }
})
