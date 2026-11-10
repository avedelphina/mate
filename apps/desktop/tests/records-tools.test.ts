import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { buildDocuments, buildTarget, newRecord } from '../src/main/records.ts'
import { runScript } from '../src/main/scripts.ts'
import { keepTrustIn, setTrusted } from '../src/main/trust.ts'

test('the tools of a template repository run as the reader asked, with words checked and nothing read by a shell', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mate-records-'))
  const out = `${root}-out`
  try {
    await mkdir(path.join(root, 'projects/arch/tools'), { recursive: true })
    await mkdir(out)
    const tool = (name: string, text: string) => writeFile(path.join(root, 'projects/arch/tools', name), text)
    // Stand-ins that print what the real tools print. The first keeps the words it was given.
    await tool(
      'repo.py',
      'import json, sys\nopen("calls.json", "a").write(json.dumps(sys.argv[1:]) + "\\n")\nif sys.argv[1] == "new": print("decisions/ADR-0001-x.md")\n'
    )
    // Arrays and [[ ]] are bash's own: the script asks for bash on its first line.
    await tool('build-docs.sh', '#!/usr/bin/env bash\nset -e\nfiles=(one two)\n[[ "$1" == --all ]] && echo "→ dist/${files[1]}.docx" || echo "→ dist/$(basename "$1" .md).docx"\n')
    keepTrustIn(path.join(out, 'trusted.json'))

    await assert.rejects(newRecord(root, 'arch', 'adr', 'A title', undefined), /only in a context you trust/)
    setTrusted(root, true)

    // A title is one argument: a quote does not end it, a dash does not make it an option.
    assert.equal(await newRecord(root, 'arch', 'adr', '--evil "Title" here', undefined), 'decisions/ADR-0001-x.md')
    assert.equal(await newRecord(root, 'arch', 'reg', 'NTLMv1', 'deviation'), 'decisions/ADR-0001-x.md')
    const calls = (await readFile(path.join(root, 'projects/arch/calls.json'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line))
    assert.deepEqual(calls, [
      ['new', 'adr', 'evil Title here'],
      ['index'],
      ['new', 'reg', 'NTLMv1', '--type', 'deviation'],
      ['index']
    ])
    await assert.rejects(newRecord(root, 'arch', 'project', 'x', undefined), /not a kind/)
    await assert.rejects(newRecord(root, 'arch', 'reg', 'x', 'nonsense'), /needs a type/)
    await assert.rejects(newRecord(root, 'arch', 'adr', '  - ', undefined), /Give the record a title/)

    assert.deepEqual((await buildDocuments(root, 'arch', '--all')).built, ['dist/two.docx'])
    assert.deepEqual((await buildDocuments(root, 'arch', 'projects/lld')).built, ['dist/lld.docx'])
    assert.deepEqual((await buildDocuments(root, 'arch', 'reviews/REV-0001-x.md')).built, ['dist/REV-0001-x.docx'])
    for (const bad of ['../x', 'projects/a b', 'projects/lld/docs', 'reviews/x.txt', 'dist', '/etc', 'projects/.hidden', '']) {
      assert.throws(() => buildTarget(bad), /Only a project or a review/, bad)
    }

    // The tools folder is only for Mate's own lines: a button of the reader's reaches scripts/ and nothing else.
    await assert.rejects(runScript(root, 'arch', 'tools/repo.py index'), /Only a script in the scripts folder/)
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(out, { recursive: true, force: true })
  }
})
