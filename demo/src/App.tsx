import { start } from 'react-scan'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useAtomValue, useSetAtom, type WritableAtom } from 'jotai'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { createYAtom, createYTextAtom } from 'y-jotai'
import './App.css'

start()

type Task = {
  id: string
  title: string
  done: boolean
}

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'

type TitleAtom = WritableAtom<string, [string | ((prev: string) => string)], void>
type NoteAtom = WritableAtom<string, [string | ((prev: string) => string)], void>
type TasksAtom = WritableAtom<Task[], [Task[] | ((prev: Task[]) => Task[])], void>

const ROOM_NAME =
  (import.meta.env.VITE_YWS_ROOM as string | undefined) ?? 'jotai-yjs-demo'
const WS_ENDPOINT =
  (import.meta.env.VITE_YWS_ENDPOINT as string | undefined) ?? 'ws://localhost:1234'

const makeId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2)

function useYSetup() {
  const setupRef = useRef<{
    doc: Y.Doc
    root: Y.Map<unknown>
    note: Y.Text
    tasks: Y.Array<Task>
    provider: WebsocketProvider
  } | null>(null)

  // eslint-disable-next-line react-hooks/refs
  if (!setupRef.current) {
    const doc = new Y.Doc()
    const root = doc.getMap<unknown>('root')

    // Use doc.getText and doc.getArray for top-level shared types
    // These are automatically synced across clients
    const note = doc.getText('note')
    const tasks = doc.getArray<Task>('tasks')

    const provider = new WebsocketProvider(WS_ENDPOINT, ROOM_NAME, doc, {
      connect: true,
    })

    // Initialize default content only after first sync, and only if empty
    provider.once('sync', (isSynced: boolean) => {
      if (isSynced) {
        if (note.length === 0) {
          note.insert(0, 'Collaborate in real time. Start typing...')
        }
        if (tasks.length === 0) {
          tasks.insert(0, [
            { id: makeId(), title: 'Sketch the layout', done: true },
            { id: makeId(), title: 'Connect to y-websocket', done: true },
            {
              id: makeId(),
              title: 'Open another tab to see live sync',
              done: false,
            },
          ])
        }
      }
    })

    setupRef.current = { doc, root, note, tasks, provider }
  }

  // eslint-disable-next-line react-hooks/refs
  return setupRef.current!
}

// Icons as simple SVG components
const IconDocument = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M4 2h5l4 4v8a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z" />
    <path d="M9 2v4h4" />
  </svg>
)

const IconTasks = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <rect x="2" y="2" width="12" height="12" rx="2" />
    <path d="M5 8l2 2 4-4" />
  </svg>
)

const IconNotes = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M3 4h10M3 8h10M3 12h6" />
  </svg>
)

const IconSettings = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <circle cx="8" cy="8" r="2" />
    <path d="M8 1v2M8 13v2M1 8h2M13 8h2M2.93 2.93l1.41 1.41M11.66 11.66l1.41 1.41M2.93 13.07l1.41-1.41M11.66 4.34l1.41-1.41" />
  </svg>
)

const IconPlus = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M7 1v12M1 7h12" />
  </svg>
)

const IconTrash = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M2 4h10M5 4V2h4v2M4 4v8h6V4" />
  </svg>
)

function Sidebar({ status, peers }: { status: ConnectionStatus; peers: number }) {
  const statusLabels: Record<ConnectionStatus, string> = {
    connecting: 'Connecting',
    connected: 'Live',
    disconnected: 'Offline',
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-logo">Y</div>
        <span className="sidebar-title">y-jotai</span>
      </div>

      <nav className="sidebar-nav">
        <button className="nav-item active">
          <IconDocument />
          <span>Workspace</span>
        </button>
        <button className="nav-item">
          <IconTasks />
          <span>All Tasks</span>
        </button>
        <button className="nav-item">
          <IconNotes />
          <span>Notes</span>
        </button>
      </nav>

      <div className="sidebar-section">
        <div className="sidebar-section-title">Connection</div>
        <div className="sidebar-nav">
          <div className="nav-item" style={{ cursor: 'default' }}>
            <span className={`status-badge ${status}`}>
              <span className="status-dot" />
              {statusLabels[status]}
            </span>
          </div>
          <div className="nav-item" style={{ cursor: 'default' }}>
            <span className="meta-badge">{peers} {peers === 1 ? 'user' : 'users'} online</span>
          </div>
        </div>
      </div>

      <div className="sidebar-footer">
        <button className="nav-item">
          <IconSettings />
          <span>Settings</span>
        </button>
      </div>
    </aside>
  )
}

function Header({ title, roomName }: { title: string; roomName: string }) {
  return (
    <header className="header">
      <div className="header-left">
        <div className="breadcrumb">
          <span>Workspace</span>
          <span className="breadcrumb-separator">/</span>
          <span className="breadcrumb-current">{title || 'Untitled'}</span>
        </div>
      </div>
      <div className="header-right">
        <span className="meta-badge">Room: {roomName}</span>
      </div>
    </header>
  )
}

function TitleSection({ titleAtom }: { titleAtom: TitleAtom }) {
  const title = useAtomValue(titleAtom)
  const setTitle = useSetAtom(titleAtom)

  return (
    <section className="section">
      <div className="section-header">
        <span className="section-title">Document Title</span>
        <span className="section-meta">Y.Map</span>
      </div>
      <div className="card">
        <div className="card-body">
          <input
            className="input input-lg"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Enter document title..."
          />
        </div>
      </div>
    </section>
  )
}

function NoteSection({ noteAtom }: { noteAtom: NoteAtom }) {
  const noteValue = useAtomValue(noteAtom)
  const setNote = useSetAtom(noteAtom)

  return (
    <section className="section">
      <div className="section-header">
        <span className="section-title">Notes</span>
        <span className="section-meta">Y.Text</span>
      </div>
      <div className="card">
        <div className="card-body">
          <textarea
            className="textarea"
            value={noteValue}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Write your notes here..."
            spellCheck={false}
          />
        </div>
      </div>
    </section>
  )
}

function TasksSection({ tasksAtom }: { tasksAtom: TasksAtom }) {
  const tasks = useAtomValue(tasksAtom)
  const setTasks = useSetAtom(tasksAtom)
  const [newTaskTitle, setNewTaskTitle] = useState('')

  const addTask = () => {
    const trimmed = newTaskTitle.trim()
    if (!trimmed) return
    const task: Task = { id: makeId(), title: trimmed, done: false }
    setTasks((prev) => [task, ...prev])
    setNewTaskTitle('')
  }

  const toggleTask = (id: string) => {
    setTasks((prev) => prev.map((task) => (task.id === id ? { ...task, done: !task.done } : task)))
  }

  const renameTask = (id: string, value: string) => {
    setTasks((prev) => prev.map((task) => (task.id === id ? { ...task, title: value } : task)))
  }

  const deleteTask = (id: string) => {
    setTasks((prev) => prev.filter((task) => task.id !== id))
  }

  return (
    <section className="section">
      <div className="section-header">
        <span className="section-title">Tasks</span>
        <span className="section-meta">Y.Array</span>
      </div>
      <div className="card">
        <div className="task-list">
          {tasks.map((task) => (
            <div key={task.id} className="task-item">
              <button
                className={`task-checkbox ${task.done ? 'checked' : ''}`}
                onClick={() => toggleTask(task.id)}
                aria-label={task.done ? 'Mark incomplete' : 'Mark complete'}
              />
              <div className="task-content">
                <input
                  className={`task-input ${task.done ? 'completed' : ''}`}
                  value={task.title}
                  onChange={(e) => renameTask(task.id, e.target.value)}
                />
              </div>
              <div className="task-actions">
                <button
                  className="btn btn-ghost btn-danger btn-sm"
                  onClick={() => deleteTask(task.id)}
                  aria-label="Delete task"
                >
                  <IconTrash />
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="add-task">
          <button className="btn btn-ghost btn-sm" onClick={addTask} aria-label="Add task">
            <IconPlus />
          </button>
          <input
            className="add-task-input"
            value={newTaskTitle}
            onChange={(e) => setNewTaskTitle(e.target.value)}
            placeholder="Add a task..."
            onKeyDown={(e) => {
              if (e.key === 'Enter') addTask()
            }}
          />
        </div>
      </div>
    </section>
  )
}

function Footer({ synced, lastUpdate, wsEndpoint, roomName }: {
  synced: boolean
  lastUpdate: string | null
  wsEndpoint: string
  roomName: string
}) {
  return (
    <footer className="footer">
      <div className="footer-meta">
        <span className="footer-item">
          Endpoint: <code>{wsEndpoint}</code>
        </span>
        <span className="footer-item">
          Room: <code>{roomName}</code>
        </span>
        <span className="footer-item">
          Synced: <code>{synced ? 'yes' : 'no'}</code>
        </span>
        {lastUpdate && (
          <span className="footer-item">
            Last update: <code>{lastUpdate}</code>
          </span>
        )}
      </div>
      <div>
        <span style={{ opacity: 0.6 }}>Open in another tab to see real-time sync</span>
      </div>
    </footer>
  )
}

function App() {
  const { doc, root, note, tasks, provider } = useYSetup()
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [peers, setPeers] = useState(1)
  const [synced, setSynced] = useState(false)
  const [lastUpdate, setLastUpdate] = useState<string | null>(null)

  useEffect(() => {
    const handleStatus = ({ status: next }: { status: 'connected' | 'disconnected' }) => {
      setStatus(next)
    }
    provider.on('status', handleStatus)

    const handleSync = (isSynced: boolean) => {
      setSynced(isSynced)
    }
    provider.on('sync', handleSync)

    const handleDocUpdate = () => {
      setLastUpdate(new Date().toLocaleTimeString())
    }
    doc.on('update', handleDocUpdate)

    const awareness = provider.awareness
    const updatePeers = () => setPeers(Math.max(1, awareness.getStates().size))
    awareness.on('change', updatePeers)
    updatePeers()

    return () => {
      provider.off('status', handleStatus)
      provider.off('sync', handleSync)
      awareness.off('change', updatePeers)
      doc.off('update', handleDocUpdate)
    }
  }, [doc, provider])

  const atoms = useMemo(() => {
    const titleAtom = createYAtom({
      y: root,
      read: (m) => (m.get('title') as string | undefined) ?? 'Collaborative Workspace',
      write: (m, next) => m.set('title', next),
      eventFilter: (evt) => (evt.keysChanged ? evt.keysChanged.has('title') : true),
    })

    const noteAtom = createYTextAtom(note)

    const tasksAtom = createYAtom({
      y: tasks,
      read: (arr) => arr.toArray(),
      write: (arr, next) => {
        arr.delete(0, arr.length)
        arr.insert(0, next)
      },
      equals: () => false,
    })

    return { titleAtom, noteAtom, tasksAtom }
  }, [root, note, tasks])

  const title = useAtomValue(atoms.titleAtom)

  return (
    <div className="app">
      <Sidebar status={status} peers={peers} />
      <main className="main">
        <Header title={title} roomName={ROOM_NAME} />
        <div className="content">
          <TitleSection titleAtom={atoms.titleAtom} />
          <NoteSection noteAtom={atoms.noteAtom} />
          <TasksSection tasksAtom={atoms.tasksAtom} />
        </div>
        <Footer
          synced={synced}
          lastUpdate={lastUpdate}
          wsEndpoint={WS_ENDPOINT}
          roomName={ROOM_NAME}
        />
      </main>
    </div>
  )
}

export default App
