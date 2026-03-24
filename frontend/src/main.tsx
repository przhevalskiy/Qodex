// Copyright (c) 2026 Aleksey Przhevalskiy. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE for details.

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from '@/app/App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
