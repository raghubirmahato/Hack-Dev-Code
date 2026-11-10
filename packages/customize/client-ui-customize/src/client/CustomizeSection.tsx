/** Customize settings section: skills, connectors and MCP servers, each on its own page. */

import { useEffect, useId, useState } from 'react'
import type { CustomizeSnapshot } from '@hackdevcode/dsh-api-remotes/client'
import { Button, Input, SegmentedTabs, Switch, Tag } from '@hackdevcode/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@hackdevcode/dsh-client-ui-slots'
import { draftServer, folders, slug } from './forms.ts'
import type { ConnectorRow, CustomServerDraft, ServerRow, SkillRow } from './forms.ts'
import css from './CustomizeSection.module.css'

/** Registration-side business face for the section. */
export interface CustomizeSectionInjected {
  /** Read the servers, connectors and skills as they stand now. */
  read: () => Promise<CustomizeSnapshot>
  /** Turn a server on or off, optionally storing its keys and folders. */
  setServer: (id: string, change: { enabled: boolean; keys?: Record<string, string>; roots?: string[] }) => Promise<void>
  /** Add or replace one of the person's own servers. */
  saveCustom: (id: string, server: CustomServerDraft) => Promise<void>
  /** Remove one of the person's own servers. */
  removeCustom: (id: string) => Promise<void>
  /** Add a connector and start its sign-in; resolves to the link to open, when one is needed. */
  connect: (choice: { id: string; url?: string; title?: string }) => Promise<string | undefined>
  /** Sign out of a connector and remove it. */
  disconnect: (id: string) => Promise<void>
  /** Install a directory skill. */
  installSkill: (id: string) => Promise<void>
  /** Remove a skill the directory installed. */
  removeSkill: (id: string) => Promise<void>
  /** Open a link in a new browser window. */
  openLink: (url: string) => void
  hooks: {
    /** Counts the Host's change announcements; each new value asks for a fresh read. */
    revision: HostObservable<number>
  }
}

/** Props the renderer binds for the section. */
export type CustomizeSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.customize'>
  & InjectFace<CustomizeSectionInjected>

type Page = 'skills' | 'connectors' | 'servers'
type Translate = CustomizeSectionProps['t']
/** Runs one change, then reads the page again; a refusal shows as the page's error line. */
type Run = (change: () => Promise<void>) => void

/** Shared by the three pages. */
interface PageProps {
  t: Translate
  busy: boolean
  run: Run
  face: CustomizeSectionProps
}

function SkillsPage({ t, busy, run, face, rows }: PageProps & { rows: readonly SkillRow[] }) {
  return (
    <>
      <p className={css.intro}>{t('skillsIntro')}</p>
      <ul className={css.cards}>
        {rows.map(skill => (
          <li key={skill.id} className={css.card}>
            <div className={css.head}>
              <span className={css.name}>{skill.title}</span>
              <Tag tone="neutral">{skill.license}</Tag>
              {skill.state !== 'no' && <Tag tone="success">{t(skill.state === 'directory' ? 'skillInstalled' : 'skillOther')}</Tag>}
              <span className={css.actions}>
                {skill.state === 'no' && (
                  <Button variant="outline" size="sm" disabled={busy} onClick={() => { run(() => face.installSkill(skill.id)) }}>
                    {t('skillInstall')}
                  </Button>
                )}
                {skill.state === 'directory' && (
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => { run(() => face.removeSkill(skill.id)) }}>
                    {t('skillRemove')}
                  </Button>
                )}
              </span>
            </div>
            <p className={css.text}>{skill.description}</p>
          </li>
        ))}
      </ul>
    </>
  )
}

function ConnectorsPage({ t, busy, run, face, rows, connectTo, fail }: PageProps & {
  rows: readonly ConnectorRow[]
  /** Starts one sign-in and opens its link. */
  connectTo: (choice: { id: string; url?: string; title?: string }, name: string) => void
  fail: (message: string) => void
}) {
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const add = () => {
    const id = slug(name)
    if (id === undefined) {
      fail(t('badName'))
      return
    }
    connectTo({ id, url: url.trim(), title: name.trim() }, name.trim())
    setName('')
    setUrl('')
  }
  return (
    <>
      <p className={css.intro}>{t('connectorsIntro')}</p>
      <ul className={css.cards}>
        {rows.map(connector => (
          <li key={connector.id} className={css.card}>
            <div className={css.head}>
              <span className={css.name}>{connector.title}</span>
              {connector.signedIn && <Tag tone="success">{t('connectorConnected')}</Tag>}
              {connector.added && !connector.signedIn && <Tag tone="warning">{t('connectorPending')}</Tag>}
              <span className={css.actions}>
                {connector.homepage !== '' && (
                  <Button variant="ghost" size="sm" onClick={() => { face.openLink(connector.homepage) }}>{t('website')}</Button>
                )}
                {!connector.signedIn && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => { connectTo({ id: connector.id }, connector.title) }}
                  >
                    {t(connector.added ? 'connectorSignIn' : 'connectorConnect')}
                  </Button>
                )}
                {connector.added && (
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => { run(() => face.disconnect(connector.id)) }}>
                    {t('connectorDisconnect')}
                  </Button>
                )}
              </span>
            </div>
            <p className={css.text}>{connector.description}</p>
          </li>
        ))}
      </ul>
      <h3 className={css.subheading}>{t('connectorAddTitle')}</h3>
      <div className={css.form}>
        <Input aria-label={t('name')} placeholder={t('name')} value={name} onChange={(event) => { setName(event.target.value) }} />
        <Input
          className={css.wide as string}
          aria-label={t('connectorUrl')}
          placeholder={t('connectorUrl')}
          value={url}
          onChange={(event) => { setUrl(event.target.value) }}
        />
        <Button variant="primary" size="sm" disabled={busy || name.trim() === '' || url.trim() === ''} onClick={add}>
          {t('connectorAdd')}
        </Button>
      </div>
    </>
  )
}

function ServerCard({ t, busy, run, face, server }: PageProps & { server: ServerRow }) {
  const [keys, setKeys] = useState<Record<string, string>>({})
  const [roots, setRoots] = useState(() => server.roots.join(', '))
  const missing = server.requires.filter(key => !key.set)
  const save = () => {
    const filled = Object.fromEntries(Object.entries(keys).filter(([, value]) => value !== ''))
    run(async () => {
      await face.setServer(server.id, {
        enabled: server.enabled,
        keys: filled,
        ...server.opensFolders ? { roots: folders(roots) } : {},
      })
      setKeys({})
    })
  }
  return (
    <li className={css.card}>
      <div className={css.head}>
        <Switch
          checked={server.enabled}
          disabled={busy}
          label={t('serverSwitch', { name: server.title })}
          onChange={(enabled) => { run(() => face.setServer(server.id, { enabled })) }}
        />
        <span className={css.name}>{server.title}</span>
        {server.custom && <Tag tone="neutral">{t('serverCustom')}</Tag>}
        <span className={css.actions}>
          {server.homepage !== '' && (
            <Button variant="ghost" size="sm" onClick={() => { face.openLink(server.homepage) }}>{t('website')}</Button>
          )}
          {server.custom && (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => { run(() => face.removeCustom(server.id)) }}>
              {t('serverRemove')}
            </Button>
          )}
        </span>
      </div>
      {server.description !== '' && <p className={css.text}>{server.description}</p>}
      <code className={css.code}>{server.url === '' ? server.command : server.url}</code>
      {server.note !== '' && <p className={css.note}>{server.note}</p>}
      {(missing.length > 0 || server.opensFolders) && (
        <div className={css.form}>
          {missing.map(key => (
            <Input
              key={key.name}
              className={css.wide as string}
              type="password"
              autoComplete="off"
              aria-label={key.name}
              placeholder={`${key.name}: ${key.description}`}
              value={keys[key.name] ?? ''}
              onChange={(event) => { setKeys({ ...keys, [key.name]: event.target.value }) }}
            />
          ))}
          {server.opensFolders && (
            <Input
              className={css.wide as string}
              aria-label={t('serverFolders')}
              placeholder={t('serverFolders')}
              value={roots}
              onChange={(event) => { setRoots(event.target.value) }}
            />
          )}
          <Button variant="outline" size="sm" disabled={busy} onClick={save}>{t('serverSave')}</Button>
        </div>
      )}
    </li>
  )
}

function ServersPage({ t, busy, run, face, rows, fail }: PageProps & { rows: readonly ServerRow[]; fail: (message: string) => void }) {
  const [name, setName] = useState('')
  const [line, setLine] = useState('')
  const add = () => {
    const id = slug(name)
    if (id === undefined) {
      fail(t('badName'))
      return
    }
    run(() => face.saveCustom(id, draftServer(name, line)))
    setName('')
    setLine('')
  }
  return (
    <>
      <p className={css.intro}>{t('serversIntro')}</p>
      <ul className={css.cards}>
        {rows.map(server => <ServerCard key={server.id} t={t} busy={busy} run={run} face={face} server={server} />)}
      </ul>
      <h3 className={css.subheading}>{t('serverAddTitle')}</h3>
      <div className={css.form}>
        <Input aria-label={t('name')} placeholder={t('name')} value={name} onChange={(event) => { setName(event.target.value) }} />
        <Input
          className={css.wide as string}
          aria-label={t('serverCommand')}
          placeholder={t('serverCommand')}
          value={line}
          onChange={(event) => { setLine(event.target.value) }}
        />
        <Button variant="primary" size="sm" disabled={busy || name.trim() === '' || line.trim() === ''} onClick={add}>
          {t('serverAdd')}
        </Button>
      </div>
    </>
  )
}

/**
 * Render the Customize page.
 * @param props - the renderer-bound face: translations, the Host calls and the change counter.
 * @returns the section with its three pages.
 */
export function CustomizeSection(props: CustomizeSectionProps) {
  const { t, read, connect, openLink, useRevision } = props
  const baseId = useId()
  const revision = useRevision(value => value)
  const [page, setPage] = useState<Page>('skills')
  const [snapshot, setSnapshot] = useState<CustomizeSnapshot>()
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [attempt, setAttempt] = useState(0)

  // Every Host announcement, finished change and retry reads the page again.
  useEffect(() => {
    read().then(setSnapshot, (reason: unknown) => { setError((reason as Error).message) })
  }, [read, revision, attempt])

  const run: Run = (change) => {
    setBusy(true)
    setError('')
    setNotice('')
    void change()
      .then(() => { setAttempt(count => count + 1) }, (reason: unknown) => { setError((reason as Error).message) })
      .finally(() => { setBusy(false) })
  }
  const connectTo = (choice: { id: string; url?: string; title?: string }, name: string) => {
    run(async () => {
      const link = await connect(choice)
      if (link === undefined) return
      openLink(link)
      setNotice(t('connectorOpened', { name }))
    })
  }
  const shared: PageProps = { t, busy, run, face: props }
  const tab = (value: Page, label: string) => ({ value, label, id: `${baseId}-tab-${value}`, panelId: `${baseId}-panel` })

  return (
    <div className={css.section}>
      <h2 className={css.heading}>{t('title')}</h2>
      <p className={css.intro}>{t('intro')}</p>
      <SegmentedTabs
        size="sm"
        className={css.tabs}
        label={t('tabs')}
        value={page}
        onChange={setPage}
        items={[tab('skills', t('tabSkills')), tab('connectors', t('tabConnectors')), tab('servers', t('tabServers'))]}
      />
      {error !== '' && (
        <p role="alert" className={css.error}>
          <span>{error}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setError('')
              setAttempt(count => count + 1)
            }}
          >
            {t('retry')}
          </Button>
        </p>
      )}
      {notice !== '' && <p role="status" className={css.notice}>{notice}</p>}
      <div id={`${baseId}-panel`} role="tabpanel" aria-labelledby={`${baseId}-tab-${page}`} className={css.panel}>
        {snapshot === undefined && error === '' && <p className={css.intro}>{t('loading')}</p>}
        {snapshot !== undefined && page === 'skills' && <SkillsPage {...shared} rows={snapshot.skills} />}
        {snapshot !== undefined && page === 'connectors' && (
          <ConnectorsPage {...shared} rows={snapshot.connectors} connectTo={connectTo} fail={setError} />
        )}
        {snapshot !== undefined && page === 'servers' && <ServersPage {...shared} rows={snapshot.servers} fail={setError} />}
      </div>
      <p className={css.footnote}>{t('pluginsNote')}</p>
    </div>
  )
}
