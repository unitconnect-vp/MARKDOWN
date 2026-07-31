# MarkView

가벼운 **마크다운 편집기 & 뷰어**.
Claude 가 만들어 준 `.md` 문서를 — 이미지, Mermaid 다이어그램, 수식까지 — 있는 그대로 보기 위해 만들었습니다.

![아이콘](build/icon.png)

---

## 왜 만들었나

Claude 가 생성한 마크다운에는 보통 이런 것들이 섞여 있습니다.

| 요소 | 일반 텍스트 편집기 | MarkView |
| --- | --- | --- |
| ` ```mermaid ` 다이어그램 | 코드 덩어리로 보임 | **SVG 로 그려짐** |
| `![](./assets/그림.png)` 로컬 이미지 | 안 보임 | **문서 폴더 기준으로 표시** |
| `$E=mc^2$` 수식 | 원문 그대로 | **KaTeX 로 조판** |
| GFM 표 · 체크리스트 · 각주 | 파이프 문자 나열 | **표와 체크박스로 표시** |

MarkView 는 이 네 가지를 기본으로 처리합니다.

---

## 설치

### 설치 파일 (권장)

빌드된 설치 파일은 GitHub Actions 의 **Windows 설치 파일 빌드 › Artifacts › `MarkView-Windows`**
에서 내려받거나, 직접 빌드하면 `release/` 에 생깁니다.

`MarkView-1.0.0-Setup.exe` 를 실행합니다. (약 80 MB, Windows 10/11 64비트)

- 기본값인 **"현재 사용자만"** 으로 설치하면 관리자 권한이 필요 없습니다.
  (설치 첫 화면에서 "모든 사용자" 를 고르면 UAC 승격이 필요합니다.)
- 설치 경로를 바꿀 수 있고, 바탕화면·시작 메뉴 바로가기를 만듭니다.
- `.md` / `.markdown` / `.mdx` 파일을 더블클릭하면 MarkView 로 열립니다.
- 제거는 **설정 › 앱** 또는 시작 메뉴의 제거 항목에서 합니다.

> 코드 서명 인증서를 붙이지 않았으므로 처음 실행할 때 Windows SmartScreen 경고가
> 나올 수 있습니다. **추가 정보 › 실행** 을 누르면 됩니다.

### 포터블

설치 없이 쓰려면 `MarkView-1.0.0-Portable.exe` 를 그대로 실행합니다.
(같은 아티팩트에 함께 들어 있습니다.)

---

## 주요 기능

**보기**
- Mermaid 11 다이어그램 (순서도, 시퀀스, 간트, 파이, 클래스, 상태, 마인드맵, ER …)
- KaTeX 수식 — `$...$`, `$$...$$`, `\(...\)`, `\[...\]`
- 로컬 이미지 — 상대 경로, 한글·공백 파일명, `<img>` 태그, data URI
- GFM 표 · 체크리스트 · 각주 · 정의 목록 · 형광펜 · 첨자
- 코드 하이라이팅 (36개 언어 + 별칭), 블록별 복사 버튼
- YAML front matter 를 속성 카드로 표시
- 라이트 / 다크 / 시스템 테마 — 다이어그램도 함께 전환

**편집**
- CodeMirror 6 기반 편집기 (마크다운 문법 강조, 찾기/바꾸기, 실행 취소)
- 편집기 ↔ 미리보기 **양방향 스크롤 동기화**
- 서식 툴바 · 단축키 (굵게, 기울임, 목록, 표, 다이어그램 삽입 …)
- 미리보기의 체크박스를 누르면 **원본 마크다운도 함께 수정**
- 여러 문서를 탭으로 열기
- 문서를 창에 끌어다 놓아 열기 / 이미지를 끌어다 놓아 삽입
- 클립보드 이미지를 붙여넣으면 `문서이름.assets/` 폴더에 저장 후 링크 삽입
- 외부에서 파일이 바뀌면 감지해 자동 반영

**내보내기**
- **HTML** — 이미지·다이어그램·폰트를 전부 파일 안에 넣은 자립형 문서 (외부 참조 0)
- **PDF** — A4, 배경·다이어그램 포함

---

## 단축키

| 기능 | 키 |
| --- | --- |
| 새 문서 / 열기 / 저장 | `Ctrl+N` · `Ctrl+O` · `Ctrl+S` |
| 다른 이름으로 저장 | `Ctrl+Shift+S` |
| PDF 내보내기 | `Ctrl+P` |
| 찾기 / 바꾸기 | `Ctrl+F` |
| 굵게 / 기울임 / 코드 / 링크 | `Ctrl+B` · `Ctrl+I` · `Ctrl+`` ` `` · `Ctrl+K` |
| 편집 / 분할 / 미리보기 | `Ctrl+1` · `Ctrl+2` · `Ctrl+3` |
| 목차 패널 | `Ctrl+\` |
| 확대 / 축소 / 원래대로 | `Ctrl++` · `Ctrl+-` · `Ctrl+0` |
| 테마 전환 | `Ctrl+Shift+T` |
| 탭 이동 / 닫기 | `Ctrl+Tab` · `Ctrl+W` |

---

## 개발

```bash
npm install
npm run icons     # 아이콘 · 샘플 이미지 생성 (최초 1회)
npm run build     # esbuild 번들링
npm start         # 앱 실행
```

### 검증

```bash
npm run test:unit          # 렌더링 파이프라인 단위 테스트 (50개)
npm run test:e2e           # 실제 Electron 창을 띄우는 시뮬레이션 (34개)
npm run verify:package     # 패키징된 앱으로 같은 시뮬레이션 재실행
npm run verify:installer   # 설치 파일 구조·아이콘·버전 정보·asar 내용 검증
```

`test:e2e` 는 실제 창을 띄워 이미지가 픽셀 단위로 로드됐는지, Mermaid SVG 가 실제 크기로
그려졌는지, 내보낸 HTML 에 외부 참조가 남지 않았는지까지 확인하고
`test-results/` 에 스크린샷과 산출물을 남깁니다. (헤드리스 환경에서는 자동으로 `xvfb-run` 사용)

### Windows 설치 파일 만들기

```bash
npm run dist:win
# → release/MarkView-<version>-Setup.exe
#   release/MarkView-<version>-Portable.exe
```

Windows 에서 빌드하면 추가 준비물이 없습니다.
**Linux/macOS 에서 크로스 빌드**할 때는 NSIS 가 제거 프로그램을 만들기 위해 설치 파일을
한 번 실행해야 하므로 `wine` (32비트 포함) 이 필요합니다.

```bash
sudo dpkg --add-architecture i386 && sudo apt-get update
sudo apt-get install -y wine64 wine32:i386
```

실행 파일의 아이콘·버전 정보는 `rcedit`(wine 필요) 대신 순수 JS 인 `resedit` 로
`scripts/after-pack.mjs` 에서 직접 넣습니다.

---

## 구조

```
src/
  shared/          Electron 비의존 · Node 에서 단위 테스트 가능
    markdown.mjs     markdown-it 파이프라인 (렌더링의 핵심)
    math.mjs         KaTeX 플러그인 ($ · $$ · \( \) · \[ \])
    highlight.mjs    highlight.js 언어 선별 등록
    slug.mjs         한글 지원 헤딩 슬러그
    pathutil.mjs     Windows/POSIX 경로 유틸
  main/            Electron 메인 프로세스
    index.mjs        창 · IPC · 파일 입출력 · 파일 감시
    assets.mjs       md-asset:// 커스텀 프로토콜 (로컬 이미지 접근 제어)
    exporter.mjs     HTML/PDF 내보내기 (이미지·폰트 인라인)
    menu.mjs         한국어 메뉴
    store.mjs        설정 · 최근 문서
  preload/         contextBridge API (화이트리스트만 노출)
  renderer/
    app.mjs          탭 · 명령 라우터 · 스크롤 동기화
    editor.mjs       CodeMirror 6
    preview.mjs      렌더링 · 정화 · Mermaid 후처리
    mermaid-entry.mjs  별도 번들 (첫 다이어그램에서 지연 로드)
    styles/
scripts/           빌드 · 아이콘 생성 · E2E · 산출물 검증
samples/           기능 안내 문서 (앱에 동봉)
test/unit/         단위 테스트
```

### 안전 장치

로컬 마크다운도 신뢰할 수 없는 입력으로 취급합니다.

- `nodeIntegration: false`, `contextIsolation: true` — 렌더러에는 화이트리스트 API 만 노출
- 렌더링된 HTML 은 **DOMPurify** 로 정화 (`script`·`iframe`·이벤트 핸들러·`javascript:` 제거)
- 로컬 이미지는 `webSecurity` 를 끄는 대신 **`md-asset://` 커스텀 프로토콜**로 제공하고,
  열려 있는 문서 폴더 밖의 경로는 거부
- CSP 로 외부 네트워크 요청 차단 — 문서가 어떤 내용이든 밖으로 나가지 않음
- data URI 는 이미지 타입만 허용 (`javascript:`·`vbscript:`·`file:` 은 계속 차단)

### 번들 크기

| 파일 | 크기 | 비고 |
| --- | ---: | --- |
| `renderer/app.js` | 1.2 MB | 편집기 + 마크다운 + 수식 + 하이라이팅 |
| `renderer/mermaid.js` | 3.3 MB | **다이어그램이 있을 때만** 로드 |
| `renderer/app.css` | 41 KB | |
| KaTeX 폰트 | ~350 KB | woff2 만 (woff·ttf 제거) |

highlight.js 는 190여 개 언어를 모두 넣는 대신 실제로 쓰이는 36개만 등록해
약 900 KB 를 줄였습니다.

---

## 라이선스

MIT
