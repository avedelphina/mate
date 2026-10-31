import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { launch } from './drive.ts'

const names = (selector: string) =>
  `[...document.querySelectorAll(${JSON.stringify(selector)})].map((each) => each.textContent + (each.classList.contains('active') ? '*' : ''))`
const mac = process.platform === 'darwin'

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
    assert.deepEqual(await app.page(names('.margin .tabs button')), ['Review*', 'Notes', 'Agent', 'tasks', 'workflow'])
    // Every file of the project is in the tree, those in folded folders too. The draft is the one on the page.
    assert.deepEqual(
      (await app.page<string[]>(names('.projects .tree .row'))).sort(),
      ['README.md', 'README.md', 'count-words.py', 'document.md*', 'intents.md', 'principles.md', 'tasks.md', 'workflow.md']
    )

    // The margin does not hold the intents or the principles. The rail has a row for each, and the page has them.
    assert.equal(await app.page(`!!document.querySelector('.margin details')`), false)
    assert.deepEqual(await app.page(names('.projects .steering .row')), ['Intents', 'Principles'])
    const intents = path.join(project, 'intents.md')
    const before = await readFile(intents, 'utf8')

    // A row opens the file on the page, where the reader types it, and the page shows what was saved.
    await app.press('.projects .steering .row', 'Intents')
    await app.until(`document.querySelector('.center .bar')?.textContent.includes('projects/document-review/intents.md')`, 'the intents on the page')
    await app.press('.center .bar button', 'Edit')
    await app.until(`!!document.querySelector('.center textarea.editor')`, 'the intents open to type in on the page')
    await app.page(`(() => {
      const box = document.querySelector('.center textarea.editor')
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(box, box.value + 'Typed on the page.\\n')
      box.dispatchEvent(new Event('input', { bubbles: true }))
    })()`)
    await app.press('.center .bar button', 'Save')
    await app.until(`!document.querySelector('.center textarea.editor') && document.querySelector('.center .page.prose').textContent.includes('Typed on the page.')`, 'the intents saved and shown on the page')
    assert.equal(await readFile(intents, 'utf8'), before + 'Typed on the page.\n')
    await app.press('.projects .tree .row', 'document.md')
    await app.until(`document.querySelector('.center .bar').textContent.includes('document.md')`, 'the draft again')

    // Select a passage, comment on it, and find the comment in the file under the passage.
    const passage = 'The shelf copy stays as it was until you publish.'
    const select = (words = passage) =>
      app.page(`(() => {
        const page = document.querySelector('.page')
        const walker = document.createTreeWalker(page, NodeFilter.SHOW_TEXT)
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const at = node.data.indexOf(${JSON.stringify(words)})
          if (at < 0) continue
          const range = document.createRange()
          range.setStart(node, at)
          range.setEnd(node, at + ${words.length})
          getSelection().removeAllRanges()
          getSelection().addRange(range)
          page.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
          return true
        }
        throw new Error('The passage is not on the page.')
      })()`)
    // What else is near the passage goes on the page as a question, and the draft is back on Esc.
    await select()
    await app.until(`!!document.querySelector('.popover.menu')`, 'the menu under the selection')
    await app.press('.popover.menu button', 'Near it')
    await app.until(`document.querySelector('.center .question h1')?.textContent === 'Near “${passage}”'`, 'what is near it, on the page')
    await app.page(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`)
    await app.until(`!document.querySelector('.center .question') && !document.querySelector('.popover')`, 'the draft again, with no menu')

    await select()
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

    // The page holds hidden markup, and a selection is counted in the file, not in what the reader sees.
    // A word picked after markup lands on its own line, and a passage over markup is found as it is written.
    const marked = '**a** **b** **bb**\n\nbb\n\nA **big** word here.\n'
    await writeFile(path.join(project, 'draft/inline.md'), marked)
    await app.page(`window.dispatchEvent(new Event('focus'))`)
    await app.until(`[...document.querySelectorAll('.projects .tree .row')].some((each) => each.textContent === 'inline.md')`, 'inline.md in the tree')
    await app.press('.projects .tree .row', 'inline.md')
    await app.until(`document.querySelector('.page')?.textContent === ${JSON.stringify(marked)}`, 'the page holds the file, markup and all')
    const span = (first: string, last: string) =>
      app.page(`(() => {
        const page = document.querySelector('.page')
        const nodes = []
        const walker = document.createTreeWalker(page, NodeFilter.SHOW_TEXT)
        for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node)
        const head = nodes.findLast((node) => node.data.includes(${JSON.stringify(first)}))
        const tail = nodes.findLast((node) => node.data.includes(${JSON.stringify(last)}))
        const range = document.createRange()
        range.setStart(head, head.data.lastIndexOf(${JSON.stringify(first)}))
        range.setEnd(tail, tail.data.lastIndexOf(${JSON.stringify(last)}) + ${last.length})
        getSelection().removeAllRanges()
        getSelection().addRange(range)
        page.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
      })()`)
    const note = async (words: string) => {
      await app.until(`!!document.querySelector('.popover.menu')`, 'the menu under the selection')
      await app.press('.popover.menu button', 'Comment')
      await app.until(`!!document.querySelector('.composer textarea[aria-label="Note"]')`, 'the form for the note')
      await app.page(`(() => {
        const note = document.querySelector('.composer textarea[aria-label="Note"]')
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(note, ${JSON.stringify(words)})
        note.dispatchEvent(new Event('input', { bubbles: true }))
      })()`)
      await app.press('.composer footer button', 'Add to the file')
      await app.until(`[...document.querySelectorAll('.thread .note')].some((each) => each.textContent.includes(${JSON.stringify(words)}))`, 'the new thread')
    }
    await span('bb', 'bb')
    await note('The second bb.')
    await span('A ', ' word')
    await note('Over markup.')
    const inline = (await readFile(path.join(project, 'draft/inline.md'), 'utf8')).split('\n')
    assert.equal(inline[1], '', 'the first line has no comment under it')
    assert.match(inline[inline.indexOf('bb') + 1], /"text":"The second bb\."/)
    assert.match(inline[inline.indexOf('A **big** word here.') + 1], /"anchor":"A \*\*big\*\* word".*"text":"Over markup\."/)

    // A folder is made from the rail, shows while it is empty, and a draft in it is a draft.
    await app.press('.projects .tree-new button', '+ New folder')
    await app.until(`!!document.querySelector('input[aria-label="Name of the new folder"]')`, 'the field for the folder')
    await app.page(`(() => {
      const field = document.querySelector('input[aria-label="Name of the new folder"]')
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, 'draft/contracts')
      field.dispatchEvent(new Event('input', { bubbles: true }))
      field.form.requestSubmit()
    })()`)
    await app.until(`[...document.querySelectorAll('.projects .tree summary')].some((each) => each.firstChild?.textContent === 'contracts')`, 'the new folder in the tree')
    await writeFile(path.join(project, 'draft/contracts/nda.md'), '# NDA\n\nBoth sides keep it secret.\n')
    await app.page(`window.dispatchEvent(new Event('focus'))`)
    await app.until(`[...document.querySelectorAll('.projects .tree .row')].some((each) => each.textContent === 'nda.md')`, 'the draft in the folder')
    await app.press('.projects .tree .row', 'nda.md')
    await app.until(`document.querySelector('.center .bar').textContent.includes('contracts/nda.md') && !!document.querySelector('.center .bar button.quiet')`, 'the draft in the folder, open for review')
    await app.press('.projects .tree .row', 'document.md')
    await app.until(`document.querySelector('.center .bar').textContent.includes('document.md')`, 'the draft again')

    // The tags in a document's front matter show in its bar and in the rail, and a click searches for them.
    await writeFile(path.join(project, 'draft/tagged.md'), '---\ntags: alpha, beta\nstatus: final\n---\n# Tagged\n\nText.\n')
    await app.page(`window.dispatchEvent(new Event('focus'))`)
    await app.until(`[...document.querySelectorAll('.projects .tree .row')].some((each) => each.textContent === 'tagged.md')`, 'the tagged draft in the tree')
    await app.press('.projects .tree .row', 'tagged.md')
    await app.until(`${names('.center .bar .tag')}.join() === '#alpha,#beta'`, 'its tags in the bar')
    await app.until(`document.querySelector('.center .bar .status.final')?.textContent === 'Final' && ${names('.projects .tree .row.final')}.join() === 'tagged.md*'`, 'its status, in the bar and in the tree')
    assert.equal(await app.page(`document.querySelector('.center .bar button.act.fit') !== null`), true)
    await app.until(`[...document.querySelectorAll('.tag-list .tag')].some((each) => each.textContent.startsWith('#alpha'))`, 'the tags in use, in the rail')
    await app.press('.center .bar .tag', '#alpha')
    await app.until(`document.querySelector('input.search').value === '#alpha' && document.querySelector('.rail').textContent.includes('Tagged')`, 'the search for the tag finds the draft')
    await app.page(`document.querySelector('input.search').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await app.press('.projects .tree .row', 'document.md')
    await app.until(`document.querySelector('.center .bar').textContent.includes('document.md')`, 'the draft again')

    // A row is dragged into a folder and the file moves, and a folder of the drafts has a plus for a draft in it.
    const drag = (rowText: string, folder: string) =>
      app.page(`(() => {
        const row = [...document.querySelectorAll('.projects .tree .row')].find((each) => each.textContent === ${JSON.stringify(rowText)})
        const target = [...document.querySelectorAll('.projects .tree summary')].find((each) => each.firstChild?.textContent === ${JSON.stringify(folder)})
        const data = new DataTransfer()
        row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: data }))
        target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: data }))
        target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }))
      })()`)
    await drag('inline.md', 'contracts')
    await app.until(`![...document.querySelectorAll('.projects .tree summary + ul .row')].some((each) => each.textContent === 'inline.md') || [...document.querySelectorAll('.projects .tree summary')].find((each) => each.firstChild?.textContent === 'contracts')?.parentElement.textContent.includes('inline.md')`, 'the file in its new folder in the tree')
    assert.equal(existsSync(path.join(project, 'draft/inline.md')), false)
    // It came with its comments, which are in the file.
    assert.match(await readFile(path.join(project, 'draft/contracts/inline.md'), 'utf8'), /A \*\*big\*\* word here\.\n<!-- @comment\{.*"text":"Over markup\."/)
    await app.page(`[...document.querySelectorAll('.projects .tree summary')].find((each) => each.firstChild?.textContent === 'contracts').querySelector('.add').click()`)
    await app.until(`document.querySelector('input[aria-label="Name of the new draft"]')?.placeholder === 'Name of the draft in contracts'`, 'the name of a draft in the folder')
    await app.page(`(() => {
      const field = document.querySelector('input[aria-label="Name of the new draft"]')
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, 'terms')
      field.dispatchEvent(new Event('input', { bubbles: true }))
      field.form.requestSubmit()
    })()`)
    await app.until(`document.querySelector('.center .bar').textContent.includes('contracts/terms.md')`, 'the new draft, in the folder')
    assert.equal(await readFile(path.join(project, 'draft/contracts/terms.md'), 'utf8'), '# terms\n')
    await app.page(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`)
    await app.press('.projects .tree .row', 'document.md')
    await app.until(`document.querySelector('.center .bar').textContent.includes('document.md')`, 'the draft again')

    // A markdown file that is not a draft is reviewed too. Its comment is kept beside it, and it cannot be published.
    const material = '# Material\n\nThe collector listens here.\n'
    await writeFile(path.join(project, 'material.md'), material)
    await app.page(`window.dispatchEvent(new Event('focus'))`)
    await app.until(`[...document.querySelectorAll('.projects .tree .row')].some((each) => each.textContent === 'material.md')`, 'the material in the tree')
    await app.press('.projects .tree .row', 'material.md')
    await app.until(`document.querySelector('.center .bar')?.textContent.includes('material.md') && !!document.querySelector('.page')`, 'the material open for review')
    assert.equal(await app.page(`[...document.querySelectorAll('.center .bar button')].map((each) => each.textContent.trim()).join()`), 'Open in editor,Edit')
    await span('collector', 'collector')
    await note('Which port?')
    assert.equal(await readFile(path.join(project, 'material.md'), 'utf8'), material, 'the file is as it was')
    assert.match(await readFile(path.join(project, 'material.md.comments.md'), 'utf8'), /Which port\?/)
    await app.press('.projects .tree .row', 'document.md')
    await app.until(`document.querySelector('.center .bar').textContent.includes('document.md')`, 'the draft again')

    // A file of text that is not markdown is reviewed too, drawn as it is. Its comment goes beside it, and it stays as it was.
    const xml = '<Sysmon schemaversion="4.90">\n  <ProcessCreate onmatch="exclude"/>\n</Sysmon>\n'
    await writeFile(path.join(project, 'sysmon.xml'), xml)
    await app.page(`window.dispatchEvent(new Event('focus'))`)
    await app.until(`[...document.querySelectorAll('.projects .tree .row')].some((each) => each.textContent === 'sysmon.xml')`, 'the XML in the tree')
    await app.press('.projects .tree .row', 'sysmon.xml')
    await app.until(`document.querySelector('.page pre.plain')?.textContent === ${JSON.stringify(xml)}`, 'the XML on the page, as it is')
    // Its line numbers are beside it, and not in its text.
    assert.equal(await app.page(`document.querySelector('.page .plain-file .gutter').dataset.lines`), '1\n2\n3')
    assert.equal(await app.page(`[...document.querySelectorAll('.center .bar button')].some((each) => each.textContent.startsWith('Publish'))`), false)
    await select('<ProcessCreate onmatch="exclude"/>')
    await app.until(`!!document.querySelector('.popover.menu')`, 'the menu under the selection')
    await app.press('.popover.menu button', 'Comment')
    await app.until(`!!document.querySelector('.composer textarea[aria-label="Note"]')`, 'the form for the note')
    await app.page(`(() => {
      const note = document.querySelector('.composer textarea[aria-label="Note"]')
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(note, 'Too wide. #detection')
      note.dispatchEvent(new Event('input', { bubbles: true }))
    })()`)
    await app.press('.composer footer button', 'Add to the file')
    await app.until(`document.querySelector('.thread .note .tag')?.textContent === '#detection'`, 'the comment, with its tag')
    assert.equal(await readFile(path.join(project, 'sysmon.xml'), 'utf8'), xml)
    assert.match(await readFile(path.join(project, 'sysmon.xml.comments.md'), 'utf8'), /"text":"Too wide\. #detection".*"line":2/)
    // The note beside the file is typed in the margin, kept beside it, and a file it names opens from there.
    await app.press('.margin .tabs button', 'Notes')
    await app.until(`document.querySelector('.margin').textContent.includes('No note on this file yet')`, 'the notes tab, with no note yet')
    await app.press('.margin .scroll button', 'Add a note')
    await app.until(`!!document.querySelector('.margin textarea.steer')`, 'the note open to type in')
    await app.page(`(() => {
      const box = document.querySelector('.margin textarea.steer')
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(box, 'The baseline is [[document.md]].\\n')
      box.dispatchEvent(new Event('input', { bubbles: true }))
    })()`)
    await app.press('.margin .scroll button', 'Save')
    await app.until(`!document.querySelector('.margin textarea.steer') && !!document.querySelector('.margin .named-files .named')`, 'the note saved, with the file it names as a button')
    assert.equal(await readFile(path.join(project, 'sysmon.xml.notes.md'), 'utf8'), 'The baseline is [[document.md]].\n')
    assert.equal(await readFile(path.join(project, 'sysmon.xml'), 'utf8'), xml)
    await app.press('.margin .named-files .named', 'document.md')
    await app.until(`document.querySelector('.center .bar').textContent.includes('document.md')`, 'the file the note names, opened')
    await app.press('.margin .tabs button', 'Review')
    await app.press('.projects .tree .row', 'document.md')
    await app.until(`document.querySelector('.center .bar').textContent.includes('document.md')`, 'the draft again')

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
    await app.until(`document.querySelector('.publish input')?.value === 'document-review/document.md'`, 'the name to publish under, which starts with the project')
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
    assert.deepEqual(await app.page(names('.margin .tabs button')), ['Review*', 'Notes', 'Agent', 'tasks', 'workflow'])

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
    assert.deepEqual(await app.page(names('.margin .tabs button')), ['Review', 'Notes', 'Agent', 'deadlines*', 'tasks', 'workflow'])

    // A file Mate cannot draw has a card with what can be done with it. Its text is taken out by the agent, when asked.
    await writeFile(path.join(project, 'dropbox/scan.pdf'), 'not a real pdf')
    await app.page(`window.dispatchEvent(new Event('focus'))`)
    await app.until(`[...document.querySelectorAll('.projects .tree .row')].some((each) => each.textContent === 'scan.pdf')`, 'the file in the tree')
    await app.press('.projects .tree .row', 'scan.pdf')
    await app.until(`document.querySelector('.source strong')?.textContent === 'scan.pdf'`, 'the card of the file')
    assert.deepEqual(await app.page(`[...document.querySelectorAll('.source .acts button')].map((each) => each.textContent.trim())`), [
      mac ? 'Show it in Finder' : 'Show it in the file manager',
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
    assert.deepEqual(await app.page(names('.margin .tabs button')), ['Review', 'Notes', 'deadlines*', 'tasks', 'workflow'])

    // Kept private, the context lets no agent in. That asks nothing, and is kept in the app's own data, not in the folder.
    await app.press('.private button', 'Keep this context private')
    await app.until(`document.querySelector('.private')?.textContent.startsWith('This context is private.')`, 'the context is private')
    assert.equal(await app.page(`[...document.querySelectorAll('.invite button')].every((each) => each.disabled)`), true)
    assert.equal(JSON.parse(await readFile(path.join(app.userData, 'private.json'), 'utf8')).length, 1)
    assert.equal(await app.page(`document.querySelector('.private button').textContent`), 'Let agents in…')
    // The reader's endpoint is set on the settings page, opened from here. Saving it asks nothing; letting it read
    // the context asks the system. The page lists this context as private, and the Agent tab knows the endpoint after.
    await app.press('.endpoint button', 'Set your endpoint…')
    await app.until(`document.querySelector('.center .settings h1')?.textContent === 'Settings'`, 'the settings page')
    await app.page(`(() => {
      const set = (at, text) => {
        const input = document.querySelectorAll('.settings .endpoint input')[at]
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, text)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      }
      set(0, 'https://llm.example.org/v1')
      set(1, 'Qwen/Qwen3.6-35B-A3B-FP8')
    })()`)
    await app.press('.settings .endpoint button', 'Save')
    await app.until(`document.querySelector('.settings .endpoint')?.textContent.includes('Saved: llm.example.org.')`, 'the endpoint, saved')
    assert.equal(await app.page(`[...document.querySelectorAll('.settings li .dir')].some((each) => each.textContent.endsWith('/example'))`), true)
    // A checkout never updates itself, and says so when asked.
    await app.press('.settings .updates button', 'Check now')
    await app.until(`document.querySelector('.settings .updates [role=status]')?.textContent === 'Run from a checkout, Mate does not update itself.'`, 'the update check, refused in a checkout')
    // An agent on another machine is not found on its own: the reader adds one, here by a host typed in, and it is kept in the app's own data.
    assert.equal(await app.page(`document.querySelector('.settings .agents .remote li').textContent`), 'None yet.')
    await app.page(`(() => {
      const input = document.querySelector('.settings .agents form input')
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'agent-host.example')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })()`)
    await app.press('.settings .agents form button', 'Add')
    await app.until(`document.querySelector('.settings .agents .remote li')?.textContent.startsWith('Hermes on agent-host.example')`, 'the agent, added')
    assert.deepEqual(JSON.parse(await readFile(path.join(app.userData, 'agents.json'), 'utf8')), [{ kind: 'hermes', host: 'agent-host.example' }])
    await app.page(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`)
    await app.until(`!document.querySelector('.center .settings') && document.querySelector('.endpoint')?.textContent.includes('Your endpoint is llm.example.org')`, 'the Agent tab, with the endpoint')
    assert.deepEqual(await app.page(`[...document.querySelectorAll('.endpoint button')].map((each) => each.textContent)`), ['Allow your endpoint here…', 'Change the endpoint…'])
    assert.equal(JSON.parse(await readFile(path.join(app.userData, 'endpoint.json'), 'utf8')).url, 'https://llm.example.org/v1')

    // A script is not run in a context the reader has not trusted.
    await app.press('.margin .tabs button', 'workflow')
    await app.page(`document.querySelector('.margin .pane .run').click()`)
    await app.until(`document.querySelector('.error')?.textContent.includes('only in a context you trust')`, 'the reader is told why it did not run')
    assert.equal(await app.page(`document.querySelectorAll('.ran').length`), 0)

    // The palette lists what the window can go to or do. A file of the project is found by a part of its name, and opened.
    await app.page(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: ${mac}, ctrlKey: ${!mac}, bubbles: true }))`)
    await app.until(`document.querySelector('dialog.palette')?.open === true`, 'the palette')
    await app.page(`(() => {
      const input = document.querySelector('dialog.palette input')
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'princ')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })()`)
    await app.until(`document.querySelectorAll('dialog.palette .row').length === 1`, 'the one file by that name')
    await app.page(`document.querySelector('dialog.palette input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`)
    await app.until(`document.querySelector('.center .bar').textContent.includes('principles.md')`, 'the file, open to be read')
    assert.equal(await app.page(`document.querySelector('dialog.palette').open`), false)

    // A project is started from the rail. It is in the folder with the two files that steer it, and it is open.
    await app.press('.project-new .row', '+ New project')
    await app.page(`(() => {
      const input = document.querySelector('.project-new input')
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Next thing')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.form.requestSubmit()
    })()`)
    await app.until(`document.querySelector('.row.project.active')?.textContent === 'Next thing'`, 'the new project, open')
    assert.deepEqual(await app.page(names('.projects .row.project')), ['Next thing*', 'document-review', 'sibling'])
    assert.deepEqual(await app.page(names('.projects .tree .row')), ['intents.md', 'principles.md'])
    assert.deepEqual((await readdir(path.join(context, 'projects/Next thing'))).sort(), ['intents.md', 'principles.md'])
    assert.equal(await app.page(`!!document.querySelector('.project-new .row')`), true)

    // The context is a context, and it is in no repository. The reader is asked about that, and git starts one.
    assert.deepEqual(await app.page(names('.rail .ask button')), ['Start a repository'])
    await app.press('.rail .ask button', 'Start a repository')
    await app.until(`document.querySelectorAll('.rail .ask').length === 0`, 'nothing left to ask')
    assert.equal(existsSync(path.join(context, '.git/HEAD')), true)

    // Committing starts what the repository names, so it is not done in a context the reader has not trusted.
    await app.press('.rail-foot button', 'Commit…')
    await app.until(`document.querySelector('.error')?.textContent.includes('commits only in a context you trust')`, 'the reader is told why nothing was committed')
    assert.equal(existsSync(path.join(context, '.git/index')), false)

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
  // A policy on the shelf as Word wrote it also checks reading its text.
  if (process.platform !== 'win32') {
    await writeFile(path.join(root, 'terms.txt'), 'Suppliers are reviewed every eighteen months.\n')
    if (mac) {
      execFileSync('/usr/bin/textutil', ['-convert', 'docx', '-output', path.join(context, 'shelf/terms.docx'), path.join(root, 'terms.txt')])
    } else {
      execFileSync(
        'libreoffice',
        ['--headless', '--norestore', `-env:UserInstallation=file://${path.join(root, 'libreoffice-profile')}`, '--convert-to', 'docx', '--outdir', path.join(context, 'shelf'), path.join(root, 'terms.txt')],
        { stdio: 'ignore' }
      )
    }
  }
  // A commit says who made it. The test is nobody in particular, whoever runs it.
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Reader', GIT_AUTHOR_EMAIL: 'reader@example.com', GIT_COMMITTER_NAME: 'Reader', GIT_COMMITTER_EMAIL: 'reader@example.com' })
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

    // A line that leaves something open asks for it first, and offers the files of the project.
    await app.page(`document.querySelectorAll('.margin .pane .run')[1].click()`)
    await app.until(`!!document.querySelector('.margin .given input')`, 'the question before the run')
    assert.ok((await app.page<string[]>(`[...document.querySelectorAll('#project-files option')].map((each) => each.value)`)).includes('intents.md'))
    await app.page(`(() => {
      const input = document.querySelector('.margin .given input')
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'intents.md')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.form.requestSubmit()
    })()`)
    await app.until(`document.querySelector('.margin .ran pre')?.textContent.startsWith('intents.md: ')`, 'what the script printed for the file that was given')

    // A script has a card of its own in the tree, and runs from there too, given nothing.
    await app.press('.projects .tree .row', 'count-words.py')
    await app.until(`document.querySelector('.source strong')?.textContent === 'count-words.py'`, 'the card of the script')
    await app.press('.source .acts button', 'Run it')
    await app.until(`!!document.querySelector('.source .ran pre')`, 'what the script printed, on its card')
    assert.match(await app.page<string>(`document.querySelector('.source .ran pre').textContent`), /^draft\/document\.md: \d+ words\n$/)

    if (process.platform !== 'win32') {
      // The Word file on the shelf is found by what it says, and read as its text, with a way to the file itself.
      await app.page(`(() => {
        const input = document.querySelector('.rail .search')
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'eighteen months')
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })()`)
      await app.until(`[...document.querySelectorAll('.rail .hit')].some((each) => each.textContent.includes('terms.docx'))`, 'the Word file among the hits')
      await app.page(`[...document.querySelectorAll('.rail .hit')].find((each) => each.textContent.includes('terms.docx')).click()`)
      await app.until(`document.querySelector('.center .bar').textContent.includes('Show the original')`, 'its text on the page')
      assert.match(await app.page<string>(`document.querySelector('.center .prose').textContent`), /Suppliers are reviewed every eighteen months/)
      // Enter asks the whole context: the question takes the page, with the passages closest in meaning, or why there are none.
      // Esc gives the page back as it was.
      await app.page(`document.querySelector('.rail .search').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`)
      await app.until(`document.querySelector('.center .question h1')?.textContent === 'eighteen months'`, 'the question on the page')
      assert.equal(await app.page(`getComputedStyle([...document.querySelectorAll('.center > .scroll')].at(-1)).display`), 'none')
      await app.until(`!!document.querySelector('.center .question .passage, .center .question .summary, .center .question h1 + p.meta')`, 'the passages, or why there are none')
      await app.page(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`)
      await app.until(`!document.querySelector('.center .question')`, 'the question closed')
      assert.match(await app.page<string>(`document.querySelector('.center .bar').textContent`), /Show the original/)
      await app.page(`(() => {
        const input = document.querySelector('.rail .search')
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '')
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })()`)
    }

    // Here the reader commits. A repository is started, and what is in the context goes into one commit, in their words.
    await app.press('.rail .ask button', 'Start a repository')
    await app.until(`!!document.querySelector('.rail-foot button')`, 'the way to commit')
    await app.press('.rail-foot button', 'Commit…')
    await app.until(`!!document.querySelector('.rail-foot input')`, 'the words of the commit are asked for')
    assert.match(await app.page<string>(`document.querySelector('.rail-foot input').placeholder`), /^What changed, in \d+ files$/)
    await app.page(`(() => {
      const input = document.querySelector('.rail-foot input')
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'The example, as it came')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.form.requestSubmit()
    })()`)
    await app.until(`/^Committed \\d+ files\\.$/.test(document.querySelector('.rail-foot .meta')?.textContent ?? '')`, 'the commit is made')
    assert.equal(await readFile(path.join(context, '.git/COMMIT_EDITMSG'), 'utf8'), 'The example, as it came\n')
    // With nothing changed since, there is nothing to commit, and the reader is told so.
    await app.press('.rail-foot button', 'Commit…')
    await app.until(`document.querySelector('.rail-foot .meta')?.textContent === 'Nothing has changed since the last commit.'`, 'nothing to commit')

    // The history of a draft: what changed since the last commit, and each commit, with what it changed.
    const draft = path.join(context, 'projects/document-review/draft/document.md')
    await writeFile(draft, (await readFile(draft, 'utf8')) + '\nA line after the commit.\n')
    await app.press('.projects .tree .row', 'document.md')
    await app.until(`[...document.querySelectorAll('.center .bar button')].some((each) => each.textContent === 'History')`, 'the History button, in a context the reader trusts')
    await app.press('.center .bar button', 'History')
    await app.until(`document.querySelectorAll('.history li .row').length === 2`, 'the change since the commit, and the commit')
    assert.deepEqual(await app.page(`[...document.querySelectorAll('.history li .row strong')].map((each) => each.textContent)`), ['Since the last commit', 'The example, as it came'])
    await app.press('.history li .row strong', 'Since the last commit')
    await app.until(`[...document.querySelectorAll('.history .diff .in')].some((each) => each.textContent === '+ A line after the commit.')`, 'the line added since')
    await app.page(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`)
    await app.until(`!document.querySelector('.center .history')`, 'the draft again')

    // The reader's editor opens the file at the line of the comment that is active: a marker line above it counts.
    // touch stands in for an editor: it makes a file named as the editor would be given it, FILE:LINE.
    await app.page(`window.mate.setEditor('/usr/bin/touch')`)
    await app.press('.margin .tabs button', 'Review')
    await app.until(`!!document.querySelector('.margin .thread')`, 'the comment in the margin')
    await app.page(`document.querySelector('.margin .thread').click()`)
    const line = (await readFile(draft, 'utf8')).split('\n').findIndex((each) => each.includes('The sentence being discussed.')) + 1
    await app.press('.center .bar button', 'Open in editor')
    for (let waited = 0; waited < 50 && !existsSync(`${await realpath(draft)}:${line}`); waited++) await new Promise((resolve) => setTimeout(resolve, 100))
    assert.equal(existsSync(`${await realpath(draft)}:${line}`), true)
  } finally {
    await app.close()
    await rm(root, { recursive: true, force: true })
  }
})
