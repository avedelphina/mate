import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { launch } from './drive.ts'

const REG = `---
id: REG-0001
type: deviation         # finding | deviation | risk-acceptance | deadline
title: "NTLMv1 on domain controllers"
status: open            # open | in-progress | closed
owner:                  # owner
decision:               # remediate | accept | change-target
created: 2026-01-05
due: 2026-02-01         # YYYY-MM-DD
---

## Description

Seen on two controllers.
`

const ADR = `---
id: ADR-0001
title: "BitLocker startup authentication"
status: proposed        # proposed | accepted | rejected | superseded
date: 2026-01-10
---

## Context

This follows REG-0001 and needs P-01. It does not change ADR-0099.
`

// Stand-in for the template's tool: it makes the record and says where it is, as the real one does.
const REPO = `import re, sys
if sys.argv[1] == "new":
    name = "decisions/ADR-0002-" + re.sub(r"[^a-z0-9]+", "-", sys.argv[3].lower()).strip("-") + ".md"
    open(name, "w").write('---\\nid: ADR-0002\\ntitle: "' + sys.argv[3] + '"\\nstatus: proposed        # proposed | accepted | rejected | superseded\\n---\\n\\n## Context\\n')
    print(name)
`

test('the records of a repository: a list of what needs the reader, IDs that open, a field picked, a record made', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mate-e2e-records-'))
  const context = path.join(root, 'ctx')
  const repo = path.join(context, 'projects/arch')
  for (const folder of ['decisions', 'register', 'tools', 'architecture', 'shelf', 'dropbox']) await mkdir(path.join(folder === 'shelf' || folder === 'dropbox' ? context : repo, folder), { recursive: true })
  await writeFile(path.join(repo, 'register/REG-0001-ntlm.md'), REG)
  await writeFile(path.join(repo, 'decisions/ADR-0001-bitlocker.md'), ADR)
  await writeFile(path.join(repo, 'architecture/principles.md'), '# Principles\n\n## P-01: Remove before you secure\n')
  await writeFile(path.join(repo, 'tools/repo.py'), REPO)
  const app = await launch(context, { 'trusted.json': JSON.stringify([await realpath(context)]) })
  const bar = `document.querySelector('.center .bar .title')?.textContent ?? ''`
  try {
    await app.until(`document.querySelector('.rail h2')?.textContent === 'ctx'`, 'the context is open')
    await app.press('.rail .row', 'arch')
    await app.until(`[...document.querySelectorAll('.tree-view button')].some((each) => each.textContent.startsWith('Records'))`, 'the Records button, once two files name an id')

    // What needs the reader is on top: the register item is past its due day, and it has no owner and no decision.
    await app.page(`[...document.querySelectorAll('.tree-view button')].find((each) => each.textContent.startsWith('Records')).click()`)
    await app.until(`document.querySelector('.records h1')?.textContent === 'Records'`, 'the records page')
    const needs = await app.page<string>(`document.querySelector('.records ul')?.textContent ?? ''`)
    assert.match(needs, /REG-0001.*due 2026-02-01, past/)
    assert.match(needs, /REG-0001.*no owner/)
    assert.match(needs, /REG-0001.*no decision/)
    assert.match(needs, /ADR-0001.*waiting for a decision/)

    // Open the decision. Its fields are above the page, and an ID in its text opens the file it names.
    await app.press('.records td button', 'BitLocker startup authentication')
    await app.until(`document.querySelector('.record-head select[aria-label=status]')?.value === 'proposed'`, 'the fields of the decision')
    assert.equal(await app.page(`document.querySelectorAll('.page .ref').length`), 2, 'REG-0001 and P-01 are links, ADR-0099 names nothing')
    // The page still holds the text of the file, front matter and all.
    assert.equal(await app.page(`document.querySelector('.page.prose').textContent.includes('This follows REG-0001 and needs P-01.')`), true)

    // Picking a status writes it into the file, and keeps the comment that lists the choices.
    await app.page(`(() => { const select = document.querySelector('.record-head select[aria-label=status]'); select.value = 'accepted'; select.dispatchEvent(new Event('change', { bubbles: true })) })()`)
    await app.until(`document.querySelector('.record-head select[aria-label=status]')?.value === 'accepted'`, 'the status is accepted')
    assert.match(await readFile(path.join(repo, 'decisions/ADR-0001-bitlocker.md'), 'utf8'), /^status: accepted {8}# proposed \| accepted \| rejected \| superseded$/m)

    await app.page(`document.querySelector('.page .ref').click()`)
    await app.until(`document.querySelector('.record-head')?.textContent.includes('REG-0001')`, 'the register item opened from its ID')
    // Its late day is marked.
    assert.equal(await app.page(`document.querySelectorAll('.record-head .field.late').length`), 1)

    // A record is made with the repository's tool, and opens.
    await app.page(`[...document.querySelectorAll('.tree-view button')].find((each) => each.textContent.startsWith('Records')).click()`)
    await app.until(`!!document.querySelector('.records h1')`, 'the records page again')
    await app.press('.records .acts button', 'New record…')
    await app.until(`!!document.querySelector('.records input[aria-label="Title of the record"]')`, 'the form')
    await app.page(`(() => { const input = document.querySelector('.records input[aria-label="Title of the record"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Use passkeys'); input.dispatchEvent(new Event('input', { bubbles: true })) })()`)
    await app.press('.records form button', 'Make')
    await app.until(`document.querySelector('.record-head select[aria-label=status]')?.value === 'proposed' && document.querySelector('.page').textContent.includes('Use passkeys')`, 'the new record is open')
    assert.match(await readFile(path.join(repo, 'decisions/ADR-0002-use-passkeys.md'), 'utf8'), /id: ADR-0002/)
    assert.match(await app.page<string>(bar), /Use passkeys|ADR-0002/)
  } finally {
    await app.close()
    await rm(root, { recursive: true, force: true })
  }
})
