import type { DocAgendaLink, ProjectDoc } from '@/types/domain'

/** 목업 저장소의 한 줄 — 서버 테이블 document 처럼 연결 줄(document_agenda)을 품는다.
    changedAgendaIds 는 들지 않는다 — 읽을 때 지금 안건의 판과 견주어 센다. 배열 순서가 seq 순서다 */
export interface MockDoc extends Omit<ProjectDoc, 'agendas' | 'changedAgendaIds'> {
  /** 연결 순서. 지운 안건의 줄도 남는다 — 읽을 때 거른다 */
  links: DocAgendaLink[]
}

/*
 * 문서 둘 — p1 에만. 목업 시연용이다(서버 시드는 없다).
 * '서버 구성' 은 인프라 파트의 글 문서로 t1 · t2 의 결정을 모았고, '결정 사항 모음' 은 공통 표 문서다.
 * 둘 다 지금 판으로 연결해 결정 바뀜은 없다 — 안건의 결정을 고치면 바로 생긴다
 */
export const documentRows: MockDoc[] = [
  {
    id: 'doc1',
    projectId: 'p1',
    title: '서버 구성',
    kind: 'text',
    content:
      '<p>개발 · 운영 서버를 무엇으로 세우는지 모은 문서입니다.</p><h3>서버 OS 결정</h3><p>우분투 최신 버전으로 한다</p><h3>DB 결정</h3><p>mysql 을 쓴다</p><ul><li><p>postgresql 은 기존 솔루션과 호환성 이슈가 있어 뺀다</p></li><li><p>supabase 는 비용 때문에 뺀다</p></li></ul>',
    sheet: { sheets: [] },
    partId: 'pt1',
    links: [
      { agendaId: 't1', seenRev: 1 },
      { agendaId: 't2', seenRev: 1 },
    ],
    rev: 3,
    createdBy: 'u3',
    createdAt: '2026-10-20T01:00:00Z',
    updatedBy: 'u3',
    updatedAt: '2026-10-21T05:30:00Z',
  },
  {
    id: 'doc2',
    projectId: 'p1',
    title: '결정 사항 모음',
    kind: 'sheet',
    content: '',
    sheet: {
      sheets: [
        {
          name: 'Sheet1',
          columns: [{ width: 280 }, { width: 360 }, { width: 120 }],
          data: [
            ['항목', '내용', '비고'],
            [
              '일정 조율 — 전체 일정을 미룰지, 테스트 기간을 줄일지',
              '전체 일정은 미루지 않고 테스트 기간만 2주 줄인다',
              '',
            ],
            ['서버 OS 결정', '우분투 최신 버전으로 한다', '인프라'],
          ],
          merges: {},
          styles: {
            A1: 'font-weight: bold',
            B1: 'font-weight: bold',
            C1: 'font-weight: bold',
            A2: 'font-weight: bold',
            A3: 'font-weight: bold',
          },
        },
      ],
    },
    partId: null,
    links: [
      { agendaId: 't6', seenRev: 1 },
      { agendaId: 't1', seenRev: 1 },
    ],
    rev: 2,
    createdBy: 'u1',
    createdAt: '2026-10-22T02:00:00Z',
    updatedBy: 'u1',
    updatedAt: '2026-10-22T02:10:00Z',
  },
]
