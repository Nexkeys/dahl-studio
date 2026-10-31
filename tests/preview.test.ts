import { describe, it, expect } from 'vitest'
import {
  fileUrlFor, filePathFromUrl, findDevServerUrl, isAllowedPreviewRequest, isAllowedPreviewUrl, isInside, normalizePreviewUrl, normPath, projectRel
} from '../src/shared/preview'

const ROOT = 'C:\\Users\\me\\My Site'

describe('preview paths', () => {
  it('normalises separators and dot segments without climbing above the drive', () => {
    expect(normPath('C:\\a\\.\\b\\..\\c\\')).toBe('C:/a/c')
    expect(normPath('C:/../../x')).toBe('C:/x')
  })
  it('checks containment case-insensitively and rejects sibling prefixes', () => {
    expect(isInside(ROOT, 'c:/users/me/my site/index.html')).toBe(true)
    expect(isInside(ROOT, ROOT)).toBe(true)
    expect(isInside(ROOT, 'C:/Users/me/My Site2/index.html')).toBe(false)
    expect(isInside(ROOT, 'C:/Users/me/My Site/../secret.txt')).toBe(false)
  })
  it('round-trips file URLs', () => {
    const url = fileUrlFor(`${ROOT}\\dist\\index.html`)
    expect(url).toBe('file:///C:/Users/me/My%20Site/dist/index.html')
    expect(filePathFromUrl(url)).toBe('C:/Users/me/My Site/dist/index.html')
    expect(projectRel(ROOT, url)).toBe('dist/index.html')
    expect(projectRel(ROOT, 'file:///C:/Windows/win.ini')).toBeNull()
    expect(filePathFromUrl('file://server/share/a.html')).toBeNull()
    expect(filePathFromUrl('http://localhost/a.html')).toBeNull()
  })
})

describe('normalizePreviewUrl', () => {
  it('expands ports and local hosts to http', () => {
    expect(normalizePreviewUrl('5173', ROOT)).toBe('http://localhost:5173/')
    expect(normalizePreviewUrl(' localhost:5173 ', ROOT)).toBe('http://localhost:5173/')
    expect(normalizePreviewUrl('127.0.0.1:3000/app?x=1', ROOT)).toBe('http://127.0.0.1:3000/app?x=1')
    expect(normalizePreviewUrl('0.0.0.0:8080', ROOT)).toBe('http://localhost:8080/')
  })
  it('keeps explicit schemes and adds https to bare domains', () => {
    expect(normalizePreviewUrl('https://example.com/a', ROOT)).toBe('https://example.com/a')
    expect(normalizePreviewUrl('example.com', ROOT)).toBe('https://example.com/')
    expect(normalizePreviewUrl('example.com:8080/x', ROOT)).toBe('http://example.com:8080/x')
  })
  it('maps project page files and absolute paths to file URLs', () => {
    expect(normalizePreviewUrl('index.html', ROOT)).toBe('file:///C:/Users/me/My%20Site/index.html')
    expect(normalizePreviewUrl('dist/index.html#top', ROOT)).toBe('file:///C:/Users/me/My%20Site/dist/index.html#top')
    expect(normalizePreviewUrl('C:\\tmp\\a.html', null)).toBe('file:///C:/tmp/a.html')
  })
  it('returns null for empty or unusable input', () => {
    expect(normalizePreviewUrl('   ', ROOT)).toBeNull()
    expect(normalizePreviewUrl('just words', ROOT)).toBeNull()
    expect(normalizePreviewUrl('index.html', null)).toBeNull()
  })
})

describe('allowed preview URLs', () => {
  it('allows web pages and project files only', () => {
    expect(isAllowedPreviewUrl('http://localhost:5173/', ROOT)).toBe(true)
    expect(isAllowedPreviewUrl('https://example.com', null)).toBe(true)
    expect(isAllowedPreviewUrl(fileUrlFor(`${ROOT}/index.html`), ROOT)).toBe(true)
    expect(isAllowedPreviewUrl('file:///C:/Users/me/My%20Site/../secrets.txt', ROOT)).toBe(false)
    expect(isAllowedPreviewUrl('file:///C:/Users/me/My%20Site/..%2F..%2Fsecrets.txt', ROOT)).toBe(false)
    expect(isAllowedPreviewUrl('file:///C:/Windows/win.ini', ROOT)).toBe(false)
    expect(isAllowedPreviewUrl(fileUrlFor(`${ROOT}/index.html`), null)).toBe(false)
    expect(isAllowedPreviewUrl('javascript:alert(1)', ROOT)).toBe(false)
    expect(isAllowedPreviewUrl('ms-settings:privacy', ROOT)).toBe(false)
    expect(isAllowedPreviewUrl('not a url', ROOT)).toBe(false)
  })
  it('lets pages open HMR sockets and inline data, but not other files', () => {
    expect(isAllowedPreviewRequest('ws://localhost:5173/?token=x', ROOT)).toBe(true)
    expect(isAllowedPreviewRequest('data:image/png;base64,AA', ROOT)).toBe(true)
    expect(isAllowedPreviewRequest('file:///C:/Users/me/.ssh/id_rsa', ROOT)).toBe(false)
    expect(isAllowedPreviewRequest('chrome://settings', ROOT)).toBe(false)
  })
})

describe('findDevServerUrl', () => {
  it('finds Vite and Next style URLs, strips colours and trailing punctuation', () => {
    expect(findDevServerUrl('  \x1b[32m➜\x1b[39m  Local:   \x1b[36mhttp://localhost:\x1b[1m5173\x1b[22m/\x1b[39m')).toBe('http://localhost:5173/')
    expect(findDevServerUrl('- Local: http://127.0.0.1:3000.')).toBe('http://127.0.0.1:3000/')
    expect(findDevServerUrl('Listening on http://0.0.0.0:8080/app')).toBe('http://localhost:8080/app')
  })
  it('ignores remote URLs and plain text', () => {
    expect(findDevServerUrl('see https://vitejs.dev/config')).toBeNull()
    expect(findDevServerUrl('compiled in 120 ms')).toBeNull()
  })
})
