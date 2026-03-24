// Copyright (c) 2026 Aleksey Przhevalskiy and Tamer Institute for Social Enterprise and Climate Change. All rights reserved.
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
