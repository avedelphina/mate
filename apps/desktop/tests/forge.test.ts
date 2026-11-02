import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { addReply, readDocument } from '../src/shared/comments.ts'
import { addComment, editDraft } from '../src/main/context.ts'
import { whereIs } from '../src/main/git.ts'
import { addForge, changeToCommit, commitToPull, forgesView, keepForgesIn, leavePull, listPulls, mergePull, mergeStyle, pullChanges, remoteOf, reviewToSend, sendReview, takePull } from '../src/main/forge.ts'

const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'ada@example.org', GIT_COMMITTER_NAME: 'Ada', GIT_COMMITTER_EMAIL: 'ada@example.org' }
const git = (dir: string, ...args: string[]) => execFileSync('git', args, { cwd: dir, env, stdio: 'pipe' }).toString().trim()
const seal = { encrypt: (text: string) => Buffer.from(`sealed:${text}`), decrypt: (sealed: Buffer) => sealed.toString().slice('sealed:'.length) }

type Answer = { status?: number; headers?: Record<string, string>; body?: unknown }

/**
 * A repository on a stand-in forge: main, and a pull request whose last commit is kept as refs/pull/1/head,
 * as Gitea and GitHub keep it. The reader's clone is a project of a context; its origin is the forge's
 * address, and git is sent to the folder in its place. `answer` stands in for the forge's API.
 */
async function forge(answer: (method: string, route: string, token: string) => Answer) {
  const root = await mkdtemp(path.join(tmpdir(), 'mate-forge-'))
  const posted: { method: string; route: string; body: unknown }[] = []
  const server = http.createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => (body += chunk))
    request.on('end', () => {
      const route = String(request.url).replace(/[?&](limit|per_page|page)=\d+/g, '')
      if (request.method !== 'GET') posted.push({ method: String(request.method), route, body: JSON.parse(body) })
      const said = answer(String(request.method), route, String(request.headers.authorization))
      response.writeHead(said.status ?? 200, { 'content-type': 'application/json', ...said.headers }).end(said.body === undefined ? '' : JSON.stringify(said.body))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = `http://127.0.0.1:${(server.address() as { port: number }).port}`

  const bare = path.join(root, 'docs.git')
  const seed = path.join(root, 'seed')
  await mkdir(seed)
  git(seed, 'init', '-q', '-b', 'main')
  await writeFile(path.join(seed, 'guide.md'), '# Guide\n\nInstall the service.\n\nRun it with the default port.\n')
  git(seed, 'add', '.')
  git(seed, 'commit', '-qm', 'First')
  const base = git(seed, 'rev-parse', 'HEAD')
  git(seed, 'switch', '-qc', 'better-setup')
  await writeFile(path.join(seed, 'guide.md'), '# Guide\n\nInstall the service.\n\nRun it with the default port, 8080.\n\nCheck the health page.\n')
  git(seed, 'commit', '-qam', 'Better')
  const head = git(seed, 'rev-parse', 'HEAD')
  git(root, 'clone', '-q', '--bare', seed, bare)
  git(bare, 'update-ref', 'refs/pull/1/head', head)

  const context = path.join(root, 'context')
  const project = path.join(context, 'projects', 'docs')
  await mkdir(path.join(context, 'projects'), { recursive: true })
  git(root, 'clone', '-q', '-b', 'main', bare, project)
  git(project, 'remote', 'set-url', 'origin', `${address}/ada/docs.git`)
  git(project, 'config', `url.${bare}.insteadOf`, `${address}/ada/docs.git`)
  keepForgesIn(path.join(root, 'forges.json'), seal)
  return { root, address, context, project, base, head, posted, close: () => (server.close(), rm(root, { recursive: true, force: true })) }
}

const pull = (base: string, head: string) => ({ number: 1, title: 'Better setup', user: { login: 'bob' }, head: { ref: 'better-setup', sha: head }, base: { ref: 'main', sha: base }, merge_base: base, html_url: 'http://forge/ada/docs/pulls/1' })

test("the origin of a repository is found on the forge it names, however git wrote its address", () => {
  const origin = (url: string) => remoteOf(`[core]\n\tbare = false\n[remote "upstream"]\n\turl = https://other.example/x/y.git\n[remote "origin"]\n\turl = ${url}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`)
  assert.deepEqual(origin('git@git.ocean:anikke/docs.git'), { host: 'git.ocean', owner: 'anikke', repo: 'docs' })
  assert.deepEqual(origin('ssh://git@Git.Ocean:2222/anikke/docs.git'), { host: 'git.ocean', owner: 'anikke', repo: 'docs' })
  assert.deepEqual(origin('https://github.com/anikke/docs'), { host: 'github.com', owner: 'anikke', repo: 'docs' })
  assert.equal(origin('/srv/git/docs.git'), null)
  assert.equal(remoteOf('[remote "upstream"]\n\turl = https://git.ocean/a/b.git\n'), null)
})

test('a pull request on Gitea is checked out, reviewed in the margin, sent as one review, and merged there', async () => {
  let at: Awaited<ReturnType<typeof forge>> | null = null
  at = await forge((method, route, token) => {
    // Gitea refuses a token it does not know everywhere, and names the scopes of one that may not do something.
    if (token === 'token wrong') return { status: 401, body: { message: 'invalid username, password or token' } }
    if (route === '/api/v1/version') return { body: { version: '1.27.3' } }
    if (route === '/api/v1/user') return token === 'token reader' ? { status: 403, body: { message: 'token does not have at least one of required scope(s), required=[read:user], token scope=read:repository' } } : { body: { login: 'ada' } }
    if (route === '/api/v1/repos/search') return { body: { ok: true, data: [] } }
    const repo = route.replace('/api/v1/repos/ada/docs', '')
    if (method === 'POST') return repo === '/pulls/1/reviews' ? { body: { id: 8 } } : {}
    if (repo === '/pulls?state=open') return { body: [pull(at!.base, at!.head)] }
    if (repo === '/pulls/1') return { body: pull(at!.base, at!.head) }
    if (repo === '/pulls/1/files') return { body: [{ filename: 'guide.md', status: 'changed' }, { filename: 'old.md', status: 'deleted' }] }
    if (repo === '/pulls/1/reviews') return { body: [{ id: 7, user: { login: 'bob' }, state: 'COMMENT', body: '' }] }
    // Bob's question on line 5, and a conversation someone resolved: that one stays on Gitea.
    if (repo === '/pulls/1/reviews/7/comments') {
      return {
        body: [
          { id: 9, body: 'Is 8080 right?', user: { login: 'bob' }, path: 'guide.md', position: 5 },
          { id: 10, body: 'Typo.', user: { login: 'bob' }, path: 'guide.md', position: 1, resolver: { login: 'ada' } }
        ]
      }
    }
    if (repo === '') return { body: { default_merge_style: 'squash' } }
    return { status: 404, body: { message: 'not here' } }
  })
  const { address, context, project, head, posted } = at
  try {
    await assert.rejects(listPulls(context, 'docs', env, true), /Add it in Settings/)
    // A forge that cannot be reached says why, as the network said it.
    await assert.rejects(addForge('http://127.0.0.1:9', 'secret'), /127\.0\.0\.1:9 could not be reached: /)
    // A token is tried before it is kept: one Gitea does not know, or one that cannot write, is refused.
    await assert.rejects(addForge(address, 'wrong'), /Gitea does not know that token/)
    await assert.rejects(addForge(address, 'reader'), /can only read:repository\. Mate needs write:repository/)
    assert.deepEqual(forgesView(), [])
    assert.deepEqual(await addForge(`${address}/`, 'secret'), [{ url: address, kind: 'gitea', user: 'ada' }])
    assert.doesNotMatch(await readFile(path.join(at.root, 'forges.json'), 'utf8'), /"secret"/)

    const listed = await listPulls(context, 'docs', env, true)
    assert.equal(listed.forge, 'Gitea')
    assert.deepEqual(listed.pulls, [{ number: 1, title: 'Better setup', author: 'bob', head: 'better-setup', base: 'main' }])
    assert.equal(listed.review, null)

    // Checked out: the files are the branch's, and Bob's open question is in the margin under its line.
    const review = await takePull(context, 'docs', 1, env)
    assert.equal(review.head, head)
    assert.deepEqual(review.files, ['guide.md'])
    assert.equal(await whereIs(project, env), head)
    const guide = path.join(project, 'guide.md')
    const taken = readDocument(await readFile(guide, 'utf8'))
    assert.equal(taken.text, '# Guide\n\nInstall the service.\n\nRun it with the default port, 8080.\n\nCheck the health page.\n')
    assert.deepEqual(taken.comments.map((each) => [each.anchor, each.text, each.author]), [['Run it with the default port, 8080.', 'Is 8080 right?', 'bob']])
    await assert.rejects(takePull(context, 'docs', 1, env), /on pull request #1/)
    assert.ok((await pullChanges(context, 'docs', 'guide.md', env)).some((line) => line.kind === '+' && line.text === 'Check the health page.'))

    // The reader comments on a passage, and an agent answers Bob.
    await addComment(context, 'docs', 'guide.md', 'health page', 'Which address?', 'you')
    await editDraft(context, 'docs', 'guide.md', (markdown) => addReply(markdown, taken.comments[0].id, 'Yes, it is the default.', 'hermes'))
    assert.equal((await reviewToSend(context, 'docs', env)).comments, 2)

    // A review sends comments only. A change to the text stops it, and the reader is told.
    const commented = await readFile(guide, 'utf8')
    await writeFile(guide, commented.replace('Install', 'Set up'))
    await assert.rejects(reviewToSend(context, 'docs', env), /You changed the text of guide\.md\. Commit it/)
    await writeFile(guide, commented)

    assert.equal(await sendReview(context, 'docs', 'APPROVED', 'Fine by me.', env), 2)
    assert.deepEqual(posted[0], {
      method: 'POST',
      route: '/api/v1/repos/ada/docs/pulls/1/reviews',
      body: {
        event: 'APPROVED',
        body: 'Fine by me.',
        commit_id: head,
        comments: [
          { path: 'guide.md', body: '**hermes:** Yes, it is the default.', new_position: 5 },
          { path: 'guide.md', body: '> health page\n\nWhich address?', new_position: 7 }
        ]
      }
    })
    // What was sent is on Gitea now. The file holds the branch's text and Gitea's conversations, and nothing is left to send.
    assert.equal(readDocument(await readFile(guide, 'utf8')).text, taken.text)
    assert.equal((await reviewToSend(context, 'docs', env)).comments, 0)

    // Gitea merges, as the repository merges. The project goes back to main, and has no review any more.
    assert.equal((await mergeStyle(context, 'docs')).style, 'squash')
    assert.deepEqual(await mergePull(context, 'docs', 'squash', env), { number: 1, base: 'main', moved: false })
    assert.deepEqual(posted[1], { method: 'POST', route: '/api/v1/repos/ada/docs/pulls/1/merge', body: { Do: 'squash' } })
    assert.equal(await whereIs(project, env), 'main')
    assert.equal(git(project, 'status', '--porcelain'), '')
    assert.equal(existsSync(path.join(project, '.git', 'mate-review.json')), false)
    await assert.rejects(leavePull(context, 'docs', env), /on no pull request/)
  } finally {
    await at.close()
  }
})

test('on GitHub Enterprise a reply joins its conversation, and a comment off the diff goes in the words of the review', async () => {
  let at: Awaited<ReturnType<typeof forge>> | null = null
  at = await forge((method, route, token) => {
    const github = { 'x-github-request-id': 'A1:B2' }
    if (route === '/api/v1/version') return { status: 404 }
    if (route === '/api/v3/meta') return { headers: github, body: {} }
    if (token !== 'Bearer secret') return { status: 401, headers: github, body: { message: 'Bad credentials' } }
    if (route === '/api/v3/user') return { headers: { ...github, 'x-oauth-scopes': 'repo, read:org' }, body: { login: 'ada' } }
    const repo = route.replace('/api/v3/repos/ada/docs', '')
    if (method !== 'GET') return { body: {} }
    if (repo === '/pulls?state=open') return { body: [pull(at!.base, at!.head)] }
    if (repo === '/pulls/1') return { body: { ...pull(at!.base, at!.head), merge_base: undefined } }
    if (repo === `/compare/${at!.base}...${at!.head}`) return { body: { merge_base_commit: { sha: at!.base } } }
    // The diff shows lines 1 to 5 of the branch's file. Line 7 is outside it.
    if (repo === '/pulls/1/files') return { body: [{ filename: 'guide.md', status: 'modified', patch: '@@ -1,5 +1,5 @@\n # Guide\n' }] }
    if (repo === '/pulls/1/comments') {
      return {
        body: [
          { id: 9, body: 'Is 8080 right?', user: { login: 'bob' }, path: 'guide.md', line: 5, side: 'RIGHT' },
          { id: 11, body: 'It was 80.', user: { login: 'bob' }, path: 'guide.md', line: 5, side: 'LEFT' }
        ]
      }
    }
    if (repo === '/pulls/1/reviews') return { body: [{ id: 7, user: { login: 'bob' }, state: 'CHANGES_REQUESTED', body: 'Port?' }] }
    if (repo === '') return { body: { allow_merge_commit: false, allow_squash_merge: true, allow_rebase_merge: true } }
    return { status: 404, body: { message: 'Not Found' } }
  })
  const { address, context, head, posted } = at
  try {
    await assert.rejects(addForge(address, 'wrong'), /GitHub does not know that token/)
    assert.deepEqual(await addForge(address, 'secret'), [{ url: address, kind: 'github', user: 'ada' }])
    const listed = await listPulls(context, 'docs', env, true)
    assert.equal(listed.forge, 'GitHub')

    const review = await takePull(context, 'docs', 1, env)
    assert.equal(review.base, at.base)
    const guide = path.join(at.project, 'guide.md')
    const taken = readDocument(await readFile(guide, 'utf8'))
    // A comment on the old side of the diff stays on GitHub.
    assert.deepEqual(taken.comments.map((each) => each.text), ['Is 8080 right?'])

    await addComment(context, 'docs', 'guide.md', 'health page', 'Which address?', 'you')
    await addComment(context, 'docs', 'guide.md', 'Install the service.', 'Say how.', 'claude')
    await editDraft(context, 'docs', 'guide.md', (markdown) => addReply(markdown, taken.comments[0].id, 'Yes, it is the default.', 'you'))
    assert.equal(await sendReview(context, 'docs', 'REQUEST_CHANGES', 'Two things.', env), 3)
    assert.deepEqual(posted, [
      { method: 'POST', route: '/api/v3/repos/ada/docs/pulls/1/comments/9/replies', body: { body: 'Yes, it is the default.' } },
      {
        method: 'POST',
        route: '/api/v3/repos/ada/docs/pulls/1/reviews',
        body: {
          commit_id: head,
          event: 'REQUEST_CHANGES',
          body: 'Two things.\n\n---\n\n**guide.md, line 7**\n\n> health page\n\nWhich address?',
          comments: [{ path: 'guide.md', line: 3, side: 'RIGHT', body: '**claude:** Say how.' }]
        }
      }
    ])

    // GitHub merges in the first way the repository allows.
    assert.equal((await mergeStyle(context, 'docs')).style, 'squash')
    await mergePull(context, 'docs', 'squash', env)
    assert.deepEqual(posted[2], { method: 'PUT', route: '/api/v3/repos/ada/docs/pulls/1/merge', body: { merge_method: 'squash', sha: head } })
  } finally {
    await at.close()
  }
})

test("the reader's change to the text goes to the pull request's branch as their commit, without the review's comments", async () => {
  let at: Awaited<ReturnType<typeof forge>> | null = null
  at = await forge((method, route) => {
    if (route === '/api/v1/version') return { body: { version: '1.27.3' } }
    if (route === '/api/v1/user') return { body: { login: 'ada' } }
    if (route === '/api/v1/repos/search') return { body: { ok: true, data: [] } }
    const repo = route.replace('/api/v1/repos/ada/docs', '')
    if (method === 'POST') return { body: { id: 8 } }
    if (repo === '/pulls?state=open' || repo === '/pulls/1') return { body: repo === '/pulls/1' ? pull(at!.base, at!.head) : [pull(at!.base, at!.head)] }
    if (repo === '/pulls/1/files') return { body: [{ filename: 'guide.md', status: 'changed' }] }
    if (repo === '/pulls/1/reviews') return { body: [] }
    return { status: 404, body: { message: 'not here' } }
  })
  const { address, context, project, head, posted } = at
  const bare = path.join(at.root, 'docs.git')
  try {
    await addForge(address, 'secret')
    await takePull(context, 'docs', 1, env)
    const guide = path.join(project, 'guide.md')
    await addComment(context, 'docs', 'guide.md', 'health page', 'Which address?', 'you')
    await writeFile(guide, (await readFile(guide, 'utf8')).replace('Check the health page.', 'Check the health page at /health.'))

    // A changed text is committed first: the comments go on the lines of that commit.
    const listed = await listPulls(context, 'docs', env, true)
    assert.deepEqual(listed.edited, ['guide.md'])
    assert.match(String(listed.pending), /Commit it to the pull request first/)
    // What the on-device model is given to word the commit: the lines the reader took out and put in, no comment.
    assert.match(await changeToCommit(context, 'docs', env), /^In guide\.md:\n[\s\S]*- Check the health page\.\n\+ Check the health page at \/health\./)
    assert.doesNotMatch(await changeToCommit(context, 'docs', env), /Which address/)

    // A branch that moved on refuses the push. The commit is taken off again, and the text stays as the reader left it.
    const other = path.join(at.root, 'other')
    git(at.root, 'clone', '-q', '-b', 'better-setup', bare, other)
    await writeFile(path.join(other, 'notes.md'), 'Someone else.\n')
    git(other, 'add', '.')
    git(other, 'commit', '-qm', 'Meanwhile')
    git(other, 'push', '-q', 'origin', 'better-setup')
    await assert.rejects(commitToPull(context, 'docs', 'Name the health page', env), /press Review again/)
    assert.equal(git(project, 'rev-parse', 'HEAD'), head)
    assert.match(await readFile(guide, 'utf8'), /at \/health\./)
    git(bare, 'update-ref', 'refs/heads/better-setup', head)

    assert.deepEqual(await commitToPull(context, 'docs', 'Name the health page', env), { files: ['guide.md'], branch: 'better-setup' })
    const pushed = git(bare, 'rev-parse', 'better-setup')
    assert.equal(git(bare, 'log', '-1', '--format=%s %an', pushed), 'Name the health page Ada')
    assert.equal(git(bare, 'show', `${pushed}:guide.md`), '# Guide\n\nInstall the service.\n\nRun it with the default port, 8080.\n\nCheck the health page at /health.')
    // The comment is still in the margin, and goes on the line of the new commit.
    assert.equal((await reviewToSend(context, 'docs', env)).comments, 1)
    await sendReview(context, 'docs', 'COMMENT', '', env)
    assert.deepEqual(posted.at(-1)?.body, { event: 'COMMENT', body: '', commit_id: pushed, comments: [{ path: 'guide.md', body: '> health page\n\nWhich address?', new_position: 7 }] })
    assert.equal(git(project, 'status', '--porcelain'), '')
  } finally {
    await at.close()
  }
})
