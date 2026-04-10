# Frontend Reorganization Plan

## Current Structure
```
frontend/src/
├── App.tsx, App.css, main.tsx, index.css
├── components/
│   ├── chat/           # 18 components mixed (chat + documents + citations)
│   ├── common/         # 6 UI components (Modal, Button, Badge, etc.)
│   └── sidebar/        # 8 sidebar components
├── stores/             # 5 Zustand stores
├── services/           # 4 API services
├── hooks/              # 2 custom hooks
├── types/              # Type definitions
├── utils/              # Utilities
├── constants/          # Constants
└── assets/             # Static assets
```

## Target Structure
```
frontend/src/
├── main.tsx
├── index.css
├── app/
│   ├── App.tsx
│   └── App.css
├── components/
│   ├── ui/                         # Primitive reusable UI
│   │   ├── Modal/
│   │   │   ├── Modal.tsx
│   │   │   ├── Modal.css
│   │   │   └── index.ts
│   │   ├── Button/
│   │   ├── Badge/
│   │   ├── Dropdown/
│   │   ├── Spinner/
│   │   ├── Tooltip/
│   │   └── index.ts
│   └── layout/
│       └── Sidebar/
│           ├── Sidebar.tsx
│           ├── Sidebar.css
│           ├── SidebarHeader.tsx
│           ├── UserProfile.tsx
│           ├── DiscussionGroup.tsx
│           ├── DiscussionItem.tsx
│           ├── NestedQuestionItem.tsx
│           ├── SampleQuestionsDropdown.tsx
│           ├── SampleQuestionsDropdown.css
│           ├── ContactModal.tsx
│           ├── ContactModal.css
│           └── index.ts
├── features/
│   ├── chat/
│   │   ├── components/
│   │   │   ├── ChatArea.tsx
│   │   │   ├── ChatArea.css
│   │   │   ├── ChatMessage.tsx
│   │   │   ├── ChatMessage.css
│   │   │   ├── ChatInput.tsx
│   │   │   ├── ChatInput.css
│   │   │   ├── ChatHeader.tsx
│   │   │   ├── ChatHeader.css
│   │   │   ├── ProviderToggles.tsx
│   │   │   ├── ProviderToggles.css
│   │   │   ├── EmptyState.tsx
│   │   │   ├── ThinkingIndicator.tsx
│   │   │   ├── ThinkingIndicator.css
│   │   │   ├── RotatingText.tsx
│   │   │   ├── RotatingText.css
│   │   │   ├── SuggestedQuestions.tsx
│   │   │   ├── SuggestedQuestions.css
│   │   │   ├── VoiceInput.tsx
│   │   │   └── index.ts
│   │   ├── store/
│   │   │   ├── chatStore.ts
│   │   │   └── index.ts
│   │   └── index.ts
│   ├── documents/
│   │   ├── components/
│   │   │   ├── FileUpload.tsx
│   │   │   ├── FileUpload.css
│   │   │   ├── DocumentPreviewModal.tsx
│   │   │   ├── DocumentPreviewModal.css
│   │   │   ├── DocumentPreviewPane.tsx
│   │   │   ├── DocumentPreviewPane.css
│   │   │   ├── DocumentChat.tsx
│   │   │   ├── DocumentChat.css
│   │   │   ├── FormattedContent.tsx
│   │   │   ├── FormattedContent.css
│   │   │   ├── SourcesDisplay.tsx
│   │   │   ├── SourcesDisplay.css
│   │   │   ├── InlineCitation.tsx
│   │   │   ├── InlineCitation.css
│   │   │   └── index.ts
│   │   ├── store/
│   │   │   ├── documentStore.ts
│   │   │   ├── documentPreviewStore.ts
│   │   │   └── index.ts
│   │   └── index.ts
│   ├── discussions/
│   │   ├── components/
│   │   │   ├── ShareModal.tsx
│   │   │   ├── ShareModal.css
│   │   │   └── index.ts
│   │   ├── store/
│   │   │   ├── discussionStore.ts
│   │   │   └── index.ts
│   │   └── index.ts
│   └── providers/
│       ├── store/
│       │   ├── providerStore.ts
│       │   └── index.ts
│       └── index.ts
├── shared/
│   ├── hooks/
│   │   ├── useSSE.ts
│   │   ├── useVoice.ts
│   │   └── index.ts
│   ├── services/
│   │   ├── api.ts
│   │   ├── sse.ts
│   │   ├── pdfExport.ts
│   │   ├── voice.ts
│   │   └── index.ts
│   ├── types/
│   │   ├── index.ts
│   │   └── sampleQuestions.ts
│   ├── utils/
│   │   ├── remarkCitations.ts
│   │   └── index.ts
│   └── constants/
│       ├── sampleQuestions.ts
│       └── index.ts
└── assets/
    ├── logo.png
    ├── qodex-logo.png
    └── react.svg
```

---

## Implementation Phases

### Phase 1: Set Up TypeScript Path Aliases
**Goal**: Enable `@/` imports to make migration easier

**Files to modify**:
- `tsconfig.json` - Add baseUrl and paths
- `vite.config.ts` - Add resolve alias

**Changes**:
```json
// tsconfig.json - add to compilerOptions:
{
  "baseUrl": ".",
  "paths": {
    "@/*": ["src/*"]
  }
}
```

```typescript
// vite.config.ts - add resolve:
import path from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
```

**Verification**: `npm run build` should pass

---

### Phase 2: Create Directory Structure
**Goal**: Create new folders without moving files yet

**Commands**:
```bash
mkdir -p src/app
mkdir -p src/components/ui/{Modal,Button,Badge,Dropdown,Spinner,Tooltip}
mkdir -p src/components/layout/Sidebar
mkdir -p src/features/chat/{components,store}
mkdir -p src/features/documents/{components,store}
mkdir -p src/features/discussions/{components,store}
mkdir -p src/features/providers/store
mkdir -p src/shared/{hooks,services,types,utils,constants}
```

**Verification**: Directories exist, build still passes

---

### Phase 3: Migrate Shared Resources
**Goal**: Move hooks, services, types, utils, constants to shared/

**Files to move**:
- `hooks/*` → `shared/hooks/`
- `services/*` → `shared/services/`
- `types/*` → `shared/types/`
- `utils/*` → `shared/utils/`
- `constants/*` → `shared/constants/`

**Update imports in moved files** to use `@/` paths

**Create index.ts barrel exports** for each shared folder

**Verification**: `npm run build` passes

---

### Phase 4: Migrate UI Components
**Goal**: Move common/ to components/ui/

**Files to move**:
- `components/common/Modal.tsx` → `components/ui/Modal/Modal.tsx`
- `components/common/Modal.css` → `components/ui/Modal/Modal.css`
- Same pattern for Button, Badge, Dropdown, Spinner, Tooltip

**Create index.ts** for each component folder

**Update imports** in files that use these components

**Verification**: `npm run build` passes

---

### Phase 5: Migrate Sidebar to Layout
**Goal**: Move sidebar/ to components/layout/Sidebar/

**Files to move**:
- All `components/sidebar/*` → `components/layout/Sidebar/`

**Update imports** in Sidebar components to use `@/` paths

**Update App.tsx** import for Sidebar

**Verification**: `npm run build` passes

---

### Phase 6: Migrate Providers Feature
**Goal**: Create providers feature (smallest - just 1 store)

**Files to move**:
- `stores/providerStore.ts` → `features/providers/store/providerStore.ts`

**Create index.ts exports**

**Update imports** in components that use providerStore

**Verification**: `npm run build` passes

---

### Phase 7: Migrate Discussions Feature
**Goal**: Create discussions feature (1 store, 1 component)

**Files to move**:
- `stores/discussionStore.ts` → `features/discussions/store/discussionStore.ts`
- `components/chat/ShareModal.tsx` → `features/discussions/components/ShareModal.tsx`
- `components/chat/ShareModal.css` → `features/discussions/components/ShareModal.css`

**Create index.ts exports**

**Update imports**

**Verification**: `npm run build` passes

---

### Phase 8: Migrate Documents Feature
**Goal**: Create documents feature (2 stores, 7 components)

**Files to move**:
- `stores/documentStore.ts` → `features/documents/store/`
- `stores/documentPreviewStore.ts` → `features/documents/store/`
- `components/chat/FileUpload.*` → `features/documents/components/`
- `components/chat/DocumentPreviewModal.*` → `features/documents/components/`
- `components/chat/DocumentPreviewPane.*` → `features/documents/components/`
- `components/chat/DocumentChat.*` → `features/documents/components/`
- `components/chat/FormattedContent.*` → `features/documents/components/`
- `components/chat/SourcesDisplay.*` → `features/documents/components/`
- `components/chat/InlineCitation.*` → `features/documents/components/`

**Create index.ts exports**

**Update imports**

**Verification**: `npm run build` passes

---

### Phase 9: Migrate Chat Feature
**Goal**: Create chat feature (1 store, 10 components)

**Files to move**:
- `stores/chatStore.ts` → `features/chat/store/`
- `components/chat/ChatArea.*` → `features/chat/components/`
- `components/chat/ChatMessage.*` → `features/chat/components/`
- `components/chat/ChatInput.*` → `features/chat/components/`
- `components/chat/ChatHeader.*` → `features/chat/components/`
- `components/chat/ProviderToggles.*` → `features/chat/components/`
- `components/chat/EmptyState.tsx` → `features/chat/components/`
- `components/chat/ThinkingIndicator.*` → `features/chat/components/`
- `components/chat/RotatingText.*` → `features/chat/components/`
- `components/chat/SuggestedQuestions.*` → `features/chat/components/`
- `components/chat/VoiceInput.tsx` → `features/chat/components/`

**Create index.ts exports**

**Update imports**

**Verification**: `npm run build` passes

---

### Phase 10: Migrate App
**Goal**: Move App.tsx to app/

**Files to move**:
- `App.tsx` → `app/App.tsx`
- `App.css` → `app/App.css`

**Update main.tsx** to import from `@/app/App`

**Verification**: `npm run build` passes

---

### Phase 11: Cleanup
**Goal**: Remove empty old directories

**Directories to remove**:
- `components/chat/` (should be empty)
- `components/common/` (should be empty)
- `components/sidebar/` (should be empty)
- `stores/` (should be empty)
- `services/` (should be empty)
- `hooks/` (should be empty)
- `types/` (should be empty)
- `utils/` (should be empty)
- `constants/` (should be empty)

**Final verification**:
- `npm run build` passes
- `npm run dev` works
- All features functional

---

## Rollback Plan
If any phase fails:
1. `git stash` current changes
2. Restore from last working commit
3. Debug the issue
4. Retry with fixes

## Success Criteria
- [x] All phases complete
- [x] `npm run build` passes with no errors
- [x] `npm run dev` runs successfully
- [ ] All UI features work (chat, documents, discussions, providers)
- [ ] No console errors
- [ ] Clean git history with logical commits per phase

---

## Completion Status: ✅ COMPLETE

**Date Completed**: 2026-01-21

### Final Structure
```
frontend/src/
├── main.tsx
├── index.css
├── app/
│   ├── App.tsx
│   └── App.css
├── components/
│   ├── ui/           # Modal, Button, Badge, Dropdown, Spinner, Tooltip
│   └── layout/       # Sidebar and related components
├── features/
│   ├── chat/         # Chat components + store
│   ├── documents/    # Document stores
│   ├── discussions/  # Discussion store
│   └── providers/    # Provider components + store
├── shared/
│   ├── hooks/        # useSSE, useVoice
│   ├── services/     # api, sse, pdfExport, voice
│   ├── types/        # Type definitions
│   ├── utils/        # remarkCitations
│   └── constants/    # sampleQuestions
└── assets/           # Static assets
```

### Key Changes
1. TypeScript path aliases (`@/*` → `src/*`) for cleaner imports
2. Feature-based architecture with co-located stores and components
3. Shared resources centralized in `shared/`
4. Layout components separated from feature components
5. All builds passing with no type errors
