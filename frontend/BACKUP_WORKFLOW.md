# Backup Workflow - Complete Implementation

## Overview

The Backup feature now implements a comprehensive workflow that matches the demo design, with **different flows for different applications**.

---

## App Categories

### 1. Request App (Special Workflow - 4 Steps)
Request app has a unique backup workflow focused on connection and storage configuration.

### 2. Generic Apps (Standard Workflow - 4 Steps)
- Workflow
- WeWork
- Service

---

## REQUEST APP WORKFLOW

### Step 1: Choose App
**UI Elements:**
- Grid of 4 application cards (2x2)
- Each card displays:
  - Large icon with colored background
  - App name (colored)
  - Description text
  - Object tags (group, request, etc.)
  - Selection indicator (checkmark)

**User Action:**
- Click any app card to select
- Selected card gets colored border and background

---

### Step 2: Connection Information

**UI Elements:**
- Header with plug icon
- Warning alert (yellow) - "Connection info used only in session"
- Two form inputs:
  1. **Domain Input**
     - Prefix: "request."
     - Placeholder: "yourdomain.com"
     - Help text with example
  2. **Access Token V2**
     - Password field with show/hide toggle
     - Help text: where to get token
- Success alert (green) - "Secure Connection" with TLS 1.3 info

**User Input Required:**
- Domain (e.g., "company.vn" → becomes "request.company.vn")
- Access Token V2 from Request app settings

**Validation:**
- Both fields required to proceed

---

### Step 3: Backup Type & Destination

**Layout:**
- Two-column layout (50/50 split)
- Left: Configuration options
- Right: Structure preview

**Left Column - Configuration:**

#### 3A. Backup Type Selection (pick one):
1. **Structured Data**
   - Icon: Excel file
   - Color: Blue (#0284c7)
   - Description: "Store as spreadsheets"
   - Suitable for: Google Sheets
   
2. **Unstructured Data**
   - Icon: Folder
   - Color: Orange (#d97706)
   - Description: "Store as folders & files"
   - Suitable for: Google Drive
   
3. **Complete Backup**
   - Icon: Database layers
   - Color: Purple (#7c3aed)
   - Description: "Full coverage"
   - Suitable for: Google Drive

**UI:** Cards with icon, title, description, and checkmark when selected

#### 3B. Destination Selection:
- Available destinations change based on backup type:
  - **Structured** → Only Google Sheets
  - **Unstructured/Complete** → Only Google Drive
  
**UI:** 
- Clickable cards showing storage provider
- Icon + name + selection indicator

#### 3C. Authentication:
After selecting destination, user must connect:
- **Not Connected State:**
  - Blue button: "Connect with Google"
  - Click opens OAuth flow (demo mode simulates)
  
- **Connected State:**
  - Green success card
  - Shows: "CONNECTED" label
  - Email address
  - Disconnect button

**Right Column - Structure Preview:**
- Dark background card (#0f172a)
- Shows folder tree structure
- Changes based on backup type selection:
  - **Structured:** Shows spreadsheet structure with 4 sheets
  - **Unstructured:** Shows folder hierarchy with files
  - **Complete:** Shows combined structure
- Empty state when no backup type selected

**Validation:**
- Must select backup type
- Must select destination
- Must connect with Google

---

### Step 4: Review Configuration

**UI Elements:**

#### 4A. Configuration Summary Card:
Grid showing 4 key values:
- Application: Request (with icon)
- Domain: request.{domain}
- Backup Type: Icon + name
- Storage: Icon + provider name

#### 4B. Data Pipeline Visualization:
- Single pipeline flow diagram
- Left box: Request API (source)
- Arrow in center
- Right box: Google Sheets/Drive (destination)
- Shows connection status with email

#### 4C. Ready to Start Alert:
- Blue info alert
- Rocket icon
- "Ready to Start Backup!" message

**User Action:**
- Review all settings
- Click "Start Backup" button (green, with rocket icon)

---

## GENERIC APP WORKFLOW
(Workflow, WeWork, Service)

### Step 1: Choose App
Same as Request Step 1

---

### Step 2: Choose Objects

**UI Elements:**
- Header with app icon
- "Select All Objects" card at top (clickable)
  - Shows count: "(X objects)"
  - Checkbox indicator
  
- List of object cards:
  - Checkbox
  - Object label (Department, Project, Task, etc.)
  - Secondary text: "AppName › ObjectName"
  - Colored border when selected
  - Colored background when selected

**Object Lists by App:**
- **Workflow:** Workflow, Job, Todo
- **WeWork:** Department, Project, Task
- **Service:** Service, Ticket

**User Action:**
- Click "Select All" or individual objects
- Must select at least one object

**Validation:**
- At least one object required

---

### Step 3: Access Token

**UI Elements:**
- Title: "Enter Access Token"
- Warning alert (yellow) - "Token not stored on servers"
- Form with password input:
  - Label: "API Access Token" with lock icon
  - Password field with show/hide toggle
  - Help text: where to find token
- Success alert (green) - "Secure Connection" with TLS info

**User Input:**
- API Access Token from app settings

**Validation:**
- Token required

---

### Step 4: Custom Fields & Configuration

Complex step with multiple sections:

#### 4A. Custom Fields Selection

**If no fields available:**
- Shows empty state

**If fields available:**

**Select All Card:**
- Checkbox
- "Select All Custom Fields"
- Count: "(X fields)"

**Fields Grouped by Object:**
- Each object type gets own section
- Section header: Object name in uppercase
- List of field cards:
  - Checkbox
  - Field name (bold)
  - Type tag (colored pill)
  - Description text
  - Colored border/bg when selected

**Field Types:**
- text, number, date, select
- input-table (structured)
- select-master (structured)

#### 4B. Backup Summary Card:
Shows 4 values in grid:
- Application (with icon)
- Objects (as colored tags)
- Access Token (masked: ••••••••1234)
- Custom Fields (count)

#### 4C. Export Format Selection

**Only shown if:**
- User selected fields with type: `input-table` or `select-master`

**UI for each structured field:**
- Field name + type tag + object name
- Two format cards side-by-side:
  
  **JSON Format:**
  - Icon: 📄
  - Title: "JSON"
  - Description: "Structured data format"
  - Checkmark when selected
  
  **Excel Format:**
  - Icon: 📊
  - Title: "Excel (.xlsx)"
  - Description: "Spreadsheet format"
  - Checkmark when selected

**User Action:**
- Choose JSON or Excel for each structured field

#### 4D. Ready to Start Alert:
- Blue info alert with rocket icon
- "Ready to Start Backup!" message

**User Action:**
- Click "Start Backup" button

---

## State Management

### Request App States:
```javascript
selectedApp        // 'request' | 'workflow' | 'wework' | 'service'
domain             // string (e.g., "company.vn")
accessTokenV2      // string (password)
showTokenV2        // boolean (show/hide toggle)
backupType         // 'structured' | 'unstructured' | 'all'
storageDestination // 'gsheets' | 'gdrive'
googleAuth         // { email, name, accessToken } | null
```

### Generic App States:
```javascript
selectedApp        // app id
selectedObjects    // array of object ids
accessToken        // string (password)
showToken          // boolean
selectedFieldIds   // array of field ids
exportFormats      // { fieldId: 'json' | 'excel' }
```

---

## Validation Rules

### Step 0 (Choose App):
- Must select one app

### Request Step 1 (Connection):
- Domain required (non-empty)
- Access Token V2 required (non-empty)

### Request Step 2 (Backup Type):
- Backup type required
- Storage destination required
- Google authentication required

### Generic Step 1 (Objects):
- At least one object selected

### Generic Step 2 (Token):
- Access token required (non-empty)

### Generic Step 3 (Config):
- No mandatory validation
- Fields selection is optional
- Export format only needed for structured fields

---

## UI/UX Features

### Color Coding:
- Each app has unique color scheme
- Used consistently for:
  - Icons
  - Borders when selected
  - Backgrounds when selected
  - Tags

### Interactive Elements:
- Hover effects on all cards
- Click-to-select behavior
- Visual feedback (borders, backgrounds)
- Disabled states when conditions not met

### Responsive Design:
- Two-column layouts for complex steps
- Grid layouts for card selections
- Mobile-friendly (cards stack vertically)

### Security Indicators:
- Warning alerts for sensitive data
- Success alerts for encryption info
- Token masking in review screens
- Clear messaging about data handling

---

## Demo/Mock Data

### Mock Custom Fields:
Defined in `MOCK_FIELDS` constant:
- Workflow: 4 fields (2 regular, 2 structured)
- WeWork: 4 fields (1 regular, 3 mixed)
- Service: 3 fields (1 regular, 2 structured)

### Mock Google Auth:
Simulated OAuth flow:
- Demo email: "demo.user@gmail.com"
- Random token generation
- 1 second delay to simulate network

---

## Next Steps for Production

1. **Replace mock OAuth:**
   - Implement real Google OAuth 2.0 flow
   - Add client ID configuration
   - Handle OAuth callbacks

2. **Connect to real APIs:**
   - Fetch actual custom fields from backend
   - Validate tokens against APIs
   - Get real object lists

3. **Add progress tracking:**
   - Real-time backup progress
   - Success/failure notifications
   - Download links for completed backups

4. **Error handling:**
   - Network errors
   - Invalid tokens
   - API rate limits
   - Storage quota exceeded

5. **Additional features:**
   - Schedule backup (cron expressions)
   - Incremental backups
   - Backup history
   - Restore functionality

---

## File Structure

```
frontend/src/pages/
  Backup.jsx          # Complete workflow implementation
  Backup.old.jsx      # Previous simple version (backup)
```

## Dependencies

All icons and components from Ant Design:
```javascript
import {
  Layout, Card, Steps, Button, Checkbox, Form, Input, 
  Select, message, Space, Tag, Alert, Modal, Tree, 
  Row, Col, Typography, Divider
} from 'antd'

import {
  InboxOutlined, ProjectOutlined, BankOutlined,
  CustomerServiceOutlined, CloudOutlined, SettingOutlined,
  CheckOutlined, EyeOutlined, EyeInvisibleOutlined,
  GoogleOutlined, FileExcelOutlined, FolderOutlined,
  DatabaseOutlined, ApiOutlined, LockOutlined,
  SafetyOutlined, WarningOutlined, RocketOutlined
} from '@ant-design/icons'
```

---

## Testing the Workflow

### Test Request Flow:
1. Select "Request" app
2. Enter domain: "company.vn"
3. Enter any token (demo mode)
4. Select "Structured Data"
5. Select "Google Sheets"
6. Click "Connect with Google" (simulates OAuth)
7. Review configuration
8. Click "Start Backup"

### Test Generic Flow (e.g., Workflow):
1. Select "Workflow" app
2. Select objects: Workflow, Job
3. Enter any token (demo mode)
4. Select custom fields (including structured fields)
5. Choose export format (JSON/Excel) for structured fields
6. Review summary
7. Click "Start Backup"

---

**Implementation Date:** April 12, 2026  
**Based on:** demo/index.html backup workflow  
**Status:** ✅ Complete - Ready for demo
