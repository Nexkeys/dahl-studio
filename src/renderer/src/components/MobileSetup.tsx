import { useCallback, useEffect, useState } from 'react'
import { CircleAlert, CircleCheck, RefreshCw, Smartphone, TriangleAlert } from 'lucide-react'
import type { MobileCheck } from '@shared/types'
import { api, useStore } from '../store'
import { FixCommand } from './FixCommand'
import '../ui-setup.css'

const ICON = { pass: CircleCheck, warn: TriangleAlert, fail: CircleAlert }

/**
 * Mobile setup checker: Java, Android SDK, adb, emulator, system image, virtual device, Windows Hypervisor Platform,
 * long paths, memory and Node. Only reads this PC's state; each failed check shows the exact fix.
 */
export function MobileSetup() {
  const [checks, setChecks] = useState<MobileCheck[] | null>(null)
  const [busy, setBusy] = useState(false)
  const notify = useStore.getState().notify
  const run = useCallback(async () => {
    setBusy(true)
    try {
      setChecks(await api.invoke<MobileCheck[]>('mobile:check'))
    } catch (e) {
      notify((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }, [notify])
  useEffect(() => void run(), [run])
  const failed = checks?.filter((c) => c.status === 'fail').length ?? 0
  const warned = checks?.filter((c) => c.status === 'warn').length ?? 0
  return (
    <div className="mobile-setup reveal" aria-label="Mobile setup checker">
      <div className="mobile-setup-head">
        <Smartphone size={16} />
        <b className="grow">Mobile setup checker</b>
        {checks && <span className={`pill ${failed ? 'error' : warned ? 'warn' : 'ok'}`}>{failed ? `${failed} to fix` : warned ? `${warned} to review` : 'Ready for Android'}</span>}
        <button className="btn small ghost" disabled={busy} onClick={() => void run()}>{busy ? <span className="spinner" /> : <RefreshCw size={12} />} Check again</button>
      </div>
      <p className="muted small">What Android development needs on this PC (Expo, React Native, Gradle and the connectors below). Checks only read your system; administrator steps are yours to do. iOS apps need a Mac.</p>
      {!checks && <div className="muted small">{busy ? 'Checking this PC...' : 'Not checked yet.'}</div>}
      {checks?.map((c) => {
        const Icon = ICON[c.status]
        return (
          <div key={c.id} className={`mcheck ${c.status}`}>
            <span className="mcheck-icon"><Icon size={15} /></span>
            <div className="mcheck-body">
              <div><b>{c.label}</b> <span className="muted">{c.status === 'pass' ? 'OK' : c.status === 'warn' ? 'check' : 'missing'}</span></div>
              <div className="mcheck-detail">{c.detail}</div>
              {c.status !== 'pass' && c.fixes.map((f, i) => <FixCommand key={i} fix={f} onDone={() => void run()} />)}
            </div>
          </div>
        )
      })}
    </div>
  )
}
