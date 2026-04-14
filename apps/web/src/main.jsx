import React from 'react'
import ReactDOM from 'react-dom/client'
import { ConfigProvider } from 'antd'
import AppRouter from '@app/router'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ConfigProvider theme={{ token: { colorPrimary: '#3b82f6', borderRadius: 6 } }}>
      <AppRouter />
    </ConfigProvider>
  </React.StrictMode>,
)