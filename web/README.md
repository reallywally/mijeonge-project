# innoFlow 프론트

Vue 3 + Vite + TypeScript + Tailwind v4 + [shadcn-vue](https://www.shadcn-vue.com).
화면 스펙은 `../design` 의 디자인 캔버스(안건 시안 페이지)를 그대로 옮긴 것이다.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # vue-tsc + vite build
npm run typecheck
npm run lint       # eslint (flat config)
npm run format     # prettier --write
npm run test       # vitest
```

개발 계획과 진행 상황은 [PLAN.md](./PLAN.md) 에 있다.

**리포는 WSL 파일시스템(`~/workspace/mijeonge-project`)에 두고 WSL node 로만 쓴다.**
`/mnt/c` 에 두면 inotify 가 없어 vite 가 폴링으로 돌아야 하고(느리고 CPU 를 먹는다),
Windows 에서 깐 `node_modules` 는 WSL node 로 못 쓴다(네이티브 바이너리가 플랫폼 전용이다).

## 구조

| 경로 | 무엇 |
| --- | --- |
| `src/assets/index.css` | shadcn-vue 기본 테마(new-york · neutral) 그대로. 본문 폰트만 IBM Plex Sans KR. 캔버스의 종이 톤(#faf8f4 · 세리프 제목)은 한 번 옮겼다가 되돌렸으니 다시 만들지 말 것 |
| `src/types/domain.ts` | Thread / Meeting / Entry. **Entry 하나가 (회의 × 안건) 한 줄**이고 안건 이력과 회의 기록이 같은 Entry 를 각자 걸러 본다. `meetingId === null` 이면 회의 밖 처리 |
| `src/stores/*.ts` | Pinia + 목업 데이터. 백엔드가 붙으면 이 파일만 바뀐다 |
| `src/components/ui/*` | shadcn-vue 컴포넌트 (직접 고쳐도 되는 사본) |
| `src/components/app/*` | 이 앱 것 — AppShell(3분할 레이아웃), ThreadStateBadge |
| `src/views/*` | 화면 |

## shadcn-vue 컴포넌트 추가하기

CLI(`npx shadcn-vue add`)는 Node 20.19+ 를 요구한다. 이 환경 Node 가 그보다 낮으면
레지스트리 JSON 을 직접 받아 쓰면 된다 — CLI 가 하는 일이 그것뿐이다.

    https://www.shadcn-vue.com/r/styles/new-york/<component>.json

`files[].content` 를 `src/components/ui/...` 로 쓰고 `dependencies` 를 설치한다.
