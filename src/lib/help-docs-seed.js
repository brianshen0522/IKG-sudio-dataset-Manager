import { DOC_SHARED_ALL, DOC_SHARED_OPERATORS, makeDocSectionKey } from './help-docs.js';

const sections = [
  {
    key: makeDocSectionKey("archive", "dataset-manager", "data-manager"),
    pageKey: "archive",
    slug: "dataset-manager",
    audienceRole: "data-manager",
    sortOrder: 10,
    translations: {
      "en": {
        title: "Archive for Dataset Manager",
        summary: "Verify completed datasets and review final history.",
        mdxContent: `

Use **Archive** to confirm that a dataset completed its operational flow.

![Screenshot_20260408_141616](/doc-assets/admin/1775628986389-2b4d6c21-Screenshot_20260408_141616.png)

## What to verify

- Final destination path
- Final edit and delete counts
- Assignment history
- Archive time and operator

`,
      },
      "zh-TW": {
        title: "Dataset Manager 的 Archive",
        summary: "確認 dataset 已完成流程，並查看最終歷史紀錄。",
        mdxContent: `

使用 **Archive** 來確認 dataset 是否已經完成整個操作流程。

![Screenshot_20260408_141616](/doc-assets/admin/1775628994292-d386b550-Screenshot_20260408_141616.png)

## 要確認什麼

- 最終目的路徑
- 最終 edit / delete 數量
- assignment history
- archive 時間與操作人

`,
      },
    },
  },
  {
    key: makeDocSectionKey("archive", "admin", "admin"),
    pageKey: "archive",
    slug: "admin",
    audienceRole: "admin",
    sortOrder: 20,
    translations: {
      "en": {
        title: "Archive for Admin",
        summary: "Review completed datasets from a system oversight perspective.",
        mdxContent: `

Admin uses **Archive** to validate the final operational result and investigate anomalies.

![Screenshot_20260408_141655](/doc-assets/admin/1775629036595-8014d0f2-Screenshot_20260408_141655.png)

## Focus points

- Unexpected archive destination
- Missing history
- Counts that do not match expectations
- Datasets that appear archived but still need background follow-up

`,
      },
      "zh-TW": {
        title: "Admin 的 Archive",
        summary: "從系統監控角度檢查已完成 dataset 的最終結果。",
        mdxContent: `

Admin 使用 **Archive** 的目的，是確認最後結果是否合理，並找出異常。

![Screenshot_20260408_141655](/doc-assets/admin/1775629041213-1350fbc4-Screenshot_20260408_141655.png)

## 主要看什麼

- archive 目的地是否異常
- 歷史紀錄是否缺漏
- 數量是否和預期不符
- 是否有看起來已 archive，但其實還需要背景追蹤的 dataset

`,
      },
    },
  },
  {
    key: makeDocSectionKey("background-jobs", "dataset-manager", "data-manager"),
    pageKey: "background-jobs",
    slug: "dataset-manager",
    audienceRole: "data-manager",
    sortOrder: 10,
    translations: {
      "en": {
        title: "Background Jobs for Dataset Manager",
        summary: "Monitor long-running tasks and read failures before retrying anything.",
        mdxContent: `

Use **Background Jobs** whenever a dataset action continues after the UI action ends.

![Screenshot_20260408_141838](/doc-assets/admin/1775629137059-f19b1e4d-Screenshot_20260408_141838.png)

## Typical tasks

- Duplicate scan
- Move to Check
- Hash preparation

## Recommended reading order

1. Task type
2. Current status
3. Recent logs
4. Related dataset state

`,
      },
      "zh-TW": {
        title: "Dataset Manager 的 Background Jobs",
        summary: "追蹤長時間工作，並在 retry 前先讀懂錯誤。",
        mdxContent: `

當某個 dataset 操作在 UI 結束後仍持續執行，就到 **Background Jobs** 看。

![Screenshot_20260408_141838](/doc-assets/admin/1775629130784-96eff373-Screenshot_20260408_141838.png)

## 常見 task

- duplicate scan
- Move to Check
- hash 準備工作

## 建議閱讀順序

1. task 類型
2. 目前狀態
3. 最近 logs
4. 對應 dataset 狀態

`,
      },
    },
  },
  {
    key: makeDocSectionKey("background-jobs", "admin", "admin"),
    pageKey: "background-jobs",
    slug: "admin",
    audienceRole: "admin",
    sortOrder: 20,
    translations: {
      "en": {
        title: "Background Jobs for Admin",
        summary: "Use this page for supervision, escalation, and system-level follow-up.",
        mdxContent: `

Admin reads **Background Jobs** to understand whether operations are healthy across the system.
![Screenshot_20260408_141748](/doc-assets/admin/1775629103250-d44e012d-Screenshot_20260408_141748.png)

- repeated failures
- tasks that are stuck too long
- suspicious retry patterns
- errors that point to path or configuration problems

`,
      },
      "zh-TW": {
        title: "Admin 的 Background Jobs",
        summary: "從系統層級監看背景工作，判斷是否需要升級處理。",
        mdxContent: `

Admin 看 **Background Jobs** 的目的是判斷整體作業是否健康。

![Screenshot_20260408_141748](/doc-assets/admin/1775629094125-b8da2154-Screenshot_20260408_141748.png)

- 重複失敗
- 卡太久的 task
- 不合理的 retry 模式
- 指向路徑或設定問題的錯誤

`,
      },
    },
  },
  {
    key: makeDocSectionKey("dataset", "dataset-manager", "data-manager"),
    pageKey: "dataset",
    slug: "dataset-manager",
    audienceRole: "data-manager",
    sortOrder: 10,
    translations: {
      "en": {
        title: "Dataset Page for Dataset Manager",
        summary: "Manage datasets, assign work, and control the operational flow from the main page.",
        mdxContent: `

The **Dataset** page is the main working page for Dataset Manager.

## What to check first

1. Confirm you are looking at the correct dataset card.
2. Read the progress, move status, and job counts.
3. Decide whether the next action is assignment, review, or move-related.

![Screenshot_20260408_140604](/doc-assets/admin/1775628393912-139a5fc1-Screenshot_20260408_140604.png)

## Main actions

- Create new datasets
- Open **Dataset Detail**
- Open **Viewer**
- Open **Editor**
- Assign or reassign work
- Start bulk dataset operations

![Screenshot_20260408_140953](/doc-assets/admin/1775628616183-41aa4343-Screenshot_20260408_140953.png)
![Screenshot_20260408_141027](/doc-assets/admin/1775628640037-0506d5d9-Screenshot_20260408_141027.png)
![Screenshot_20260408_141100](/doc-assets/admin/1775628670323-d9aa6295-Screenshot_20260408_141100.png)

<Warning title="Do not assign before checking dataset state" />

Do not assign or reassign jobs before checking whether the dataset is already moving, archived, or blocked by another operation.

`,
      },
      "zh-TW": {
        title: "Dataset Manager 的 Dataset 頁面",
        summary: "從主頁管理 dataset、分配工作、控制作業流程。",
        mdxContent: `

**Dataset** 是 Dataset Manager 的主要工作頁。

## 進來先確認

1. 先確定你看的 dataset 卡片是正確的
2. 看進度、move 狀態和 job 數量
3. 判斷下一步是要分配工作、查看細節，還是做 move 相關操作

![Screenshot_20260408_140604](/doc-assets/admin/1775628376812-c20bec77-Screenshot_20260408_140604.png)

## 主要操作

- 建立新 dataset
- 開啟 **Dataset Detail**
- 開啟 **Viewer**
- 開啟 **Editor**
- 指派或重新指派工作
- 啟動批次 dataset 操作

![Screenshot_20260408_140953](/doc-assets/admin/1775628605971-f576d439-Screenshot_20260408_140953.png)
![Screenshot_20260408_141027](/doc-assets/admin/1775628635239-6d9a0533-Screenshot_20260408_141027.png)
![Screenshot_20260408_141100](/doc-assets/admin/1775628674228-54757286-Screenshot_20260408_141100.png)

<Warning title="先確認 dataset 狀態再分配" />

在確認 dataset 是否正在 move、是否已 archive、或是否被其他流程鎖定之前，不要先做 assign 或 reassign。

`,
      },
    },
  },
  {
    key: makeDocSectionKey("dataset", "admin", "admin"),
    pageKey: "dataset",
    slug: "admin",
    audienceRole: "admin",
    sortOrder: 20,
    translations: {
      "en": {
        title: "Dataset Page for Admin",
        summary: "Monitor dataset operations and verify that managers are using the system correctly.",
        mdxContent: `

Admin uses the **Dataset** page for oversight, not for editing work.

## What Admin should watch

- Whether dataset types and paths look correct
- Whether jobs are assigned to the correct active users
- Whether datasets are stuck in move-related states
- Whether follow-up is needed in **Archive** or **Background Jobs**

![Screenshot_20260408_141145](/doc-assets/admin/1775628715524-b243664d-Screenshot_20260408_141145.png)

## Typical admin use

1. Review the overall dataset list
2. Check unusual progress or failed movement states
3. Open related admin pages when operational follow-up is required

<Warning title="Admin is not an editor role" />

Admin can oversee datasets, but should not be documented as a labeling operator on this page.

`,
      },
      "zh-TW": {
        title: "Admin 的 Dataset 頁面",
        summary: "從系統監控角度查看 dataset 狀態，確認管理流程是否正常。",
        mdxContent: `

Admin 使用 **Dataset** 頁的目的主要是監控，不是做編輯工作。

## Admin 應該注意什麼

- dataset type 與路徑是否看起來正確
- job 是否被指派給正確且 active 的使用者
- dataset 是否卡在 move 相關狀態
- 是否需要再進 **Archive** 或 **Background Jobs** 做後續確認

![Screenshot_20260408_141145](/doc-assets/admin/1775628723201-08aa8e2c-Screenshot_20260408_141145.png)

## Admin 常見使用方式

1. 先看整體 dataset 列表
2. 找出異常進度或失敗的 move 狀態
3. 需要進一步處理時，再進相關 admin 頁

<Warning title="Admin 不是編輯角色" />

Admin 可以監看 dataset，但不應在這一頁以標註操作者的角度理解流程。

`,
      },
    },
  },
  {
    key: makeDocSectionKey("dataset-detail", "dataset-manager", "data-manager"),
    pageKey: "dataset-detail",
    slug: "dataset-manager",
    audienceRole: "data-manager",
    sortOrder: 10,
    translations: {
      "en": {
        title: "Dataset Detail for Dataset Manager",
        summary: "Inspect one dataset in depth and manage job assignment and move flow safely.",
        mdxContent: `

Use **Dataset Detail** when you need job-level control for one dataset.

## What this page contains

- Progress summary
- Jobs table
- Assignment status
- Edit and delete statistics
- Dataset-level actions

![Screenshot_20260408_141100](/doc-assets/admin/1775628674228-54757286-Screenshot_20260408_141100.png)

## Recommended workflow

1. Read the progress summary first
2. Check the jobs table
3. Confirm assignees and statuses
4. Only then run dataset-level actions such as bulk assignment or **Move to Check**

![Screenshot_20260408_141258](/doc-assets/admin/1775628792175-8244a8de-Screenshot_20260408_141258.png)
`,
      },
      "zh-TW": {
        title: "Dataset Manager 的 Dataset Detail",
        summary: "在單一 dataset 內查看 job 細節，安全管理指派與 move 流程。",
        mdxContent: `

當你需要控制單一 dataset 的 job 層級流程時，就使用 **Dataset Detail**。

## 這一頁包含什麼

- progress summary
- jobs table
- assignment 狀態
- edit 與 delete 統計
- dataset 層級操作
- 
![Screenshot_20260408_141100](/doc-assets/admin/1775628674228-54757286-Screenshot_20260408_141100.png)

## 建議流程

1. 先看 progress summary
2. 再看 jobs table
3. 確認 assignee 和狀態
4. 確認完再做 bulk assignment 或 **Move to Check** 之類的 dataset 操作

![Screenshot_20260408_141258](/doc-assets/admin/1775628799031-eaba3c02-Screenshot_20260408_141258.png)
`,
      },
    },
  },
  {
    key: makeDocSectionKey("editor", "shared", DOC_SHARED_OPERATORS),
    pageKey: "editor",
    slug: "shared",
    audienceRole: DOC_SHARED_OPERATORS,
    sortOrder: 10,
    translations: {
      "en": {
        title: "Editor",
        summary: "Use Editor for labeling work. This page is shared only by User and Dataset Manager.",
        mdxContent: `

**Editor** is shared by User and Dataset Manager because both perform the same labeling actions.

![ezgif 7e4b5df784bae3fd](/doc-assets/admin/1775629678128-9561cfe2-ezgif-7e4b5df784bae3fd.gif)

## Standard workflow

1. Open the correct job
2. Confirm the current image
3. Edit labels
4. Save before moving away

<Warning title="Admin does not use Editor" />

This manual does not describe Editor for Admin because Admin is not an editing role.

`,
      },
      "zh-TW": {
        title: "Editor",
        summary: "用 Editor 做標註工作。這一頁只給 User 和 Dataset Manager 共用。",
        mdxContent: `

**Editor** 只給 User 和 Dataset Manager 共用，因為這兩個角色的標註動作相同。

![ezgif 7e4b5df784bae3fd](/doc-assets/admin/1775629668111-bd9d8540-ezgif-7e4b5df784bae3fd.gif)

## 標準流程

1. 開啟正確的 job
2. 確認目前圖片
3. 編輯標註
4. 離開前先儲存

<Warning title="Admin 不使用 Editor" />

這份手冊不會為 Admin 寫 Editor，因為 Admin 不是編輯角色。

`,
      },
    },
  },
  {
    key: makeDocSectionKey("my-jobs", "user", "user"),
    pageKey: "my-jobs",
    slug: "user",
    audienceRole: "user",
    sortOrder: 10,
    translations: {
      "en": {
        title: "My Jobs for User",
        summary: "Use this page as your personal work queue.",
        mdxContent: `

**My Jobs** is the main landing page for User.

## What to do here

1. Find the assigned job you need to continue
2. Check the status before opening it
3. Open **Viewer** if you only need to inspect
4. Open **Editor** if you need to continue labeling

![Screenshot_20260408_141423](/doc-assets/admin/1775628876867-651cbb01-Screenshot_20260408_141423.png)

## What not to do

- Do not continue from an old tab if the current page no longer shows the job
- Do not assume you still own the job until you confirm the current assignment

`,
      },
      "zh-TW": {
        title: "User 的 My Jobs",
        summary: "把這一頁當成你自己的工作清單入口。",
        mdxContent: `

**My Jobs** 是 User 的主要入口頁。

## 在這裡要做什麼

1. 找到你要接續處理的 assigned job
2. 開啟前先看目前狀態
3. 只想檢查內容時開 **Viewer**
4. 需要繼續標註時開 **Editor**

![Screenshot_20260408_141423](/doc-assets/admin/1775628882793-4d965a71-Screenshot_20260408_141423.png)

## 不要做什麼

- 如果這一頁已經看不到該 job，不要從舊分頁繼續做
- 在確認目前指派狀態之前，不要假設這個 job 還是你的

`,
      },
    },
  },
  {
    key: makeDocSectionKey("my-jobs", "dataset-manager", "data-manager"),
    pageKey: "my-jobs",
    slug: "dataset-manager",
    audienceRole: "data-manager",
    sortOrder: 20,
    translations: {
      "en": {
        title: "My Jobs for Dataset Manager",
        summary: "Track your own assigned jobs separately from dataset management work.",
        mdxContent: `

Dataset Manager may also have personal jobs. Use **My Jobs** for your own assigned work, not for dataset-wide control.

## Difference from Dataset page

- **Dataset** is for managing and distributing work
- **My Jobs** is only for jobs assigned directly to you

![Screenshot_20260408_141512](/doc-assets/admin/1775628935248-797abd18-Screenshot_20260408_141512.png)

<Note title="Keep management and personal work separate" />

When you switch from management to your own assigned job, confirm that you are now acting as an operator, not as a dataset controller.

`,
      },
      "zh-TW": {
        title: "Dataset Manager 的 My Jobs",
        summary: "把自己被指派的工作，和 dataset 管理工作分開看。",
        mdxContent: `

Dataset Manager 也可能有自己的 assigned job。**My Jobs** 是拿來看你自己的工作，不是拿來做 dataset 全域管理。

## 和 Dataset 頁的差別

- **Dataset** 是拿來管理與分配工作
- **My Jobs** 只看直接指派給你的 job

![Screenshot_20260408_141512](/doc-assets/admin/1775628929393-f785622a-Screenshot_20260408_141512.png)

<Note title="把管理和個人工作分開" />

當你從管理流程切到自己的 assigned job 時，要確認你現在是在用操作者角度工作，不是在做 dataset 控制。

`,
      },
    },
  },
  {
    key: makeDocSectionKey("settings", "admin", "admin"),
    pageKey: "settings",
    slug: "admin",
    audienceRole: "admin",
    sortOrder: 10,
    translations: {
      "en": {
        title: "Settings",
        summary: "Manage dataset types and system-wide defaults carefully.",
        mdxContent: `

**Settings** controls system-wide behavior.

![Screenshot_20260408_141958](/doc-assets/admin/1775629224332-b3a8ca42-Screenshot_20260408_141958.png)

## Check before saving

- path values
- dataset type mapping
- duplicate defaults
- move retry behavior

<Warning title="A wrong path here affects future workflows" />

`,
      },
      "zh-TW": {
        title: "Settings",
        summary: "小心管理 dataset type 與系統層級預設值。",
        mdxContent: `

**Settings** 會影響整個系統後續行為。

![Screenshot_20260408_141958](/doc-assets/admin/1775629206702-7c99eb70-Screenshot_20260408_141958.png)

## 儲存前先確認

- path 值
- dataset type 對應
- duplicate 預設值
- move retry 行為

<Warning title="這裡路徑錯誤會影響後續流程" />

`,
      },
    },
  },
  {
    key: makeDocSectionKey("shortcuts", "shared", DOC_SHARED_ALL),
    pageKey: "shortcuts",
    slug: "shared",
    audienceRole: DOC_SHARED_ALL,
    sortOrder: 10,
    translations: {
      "en": {
        title: "Shortcuts",
        summary: "Review the current shortcut map before relying on muscle memory.",
        mdxContent: `

Use **Shortcuts** to confirm the current key bindings for navigation and editing.

![Screenshot_20260408_142829](/doc-assets/admin/1775629736911-f1480274-Screenshot_20260408_142829.png)
`,
      },
      "zh-TW": {
        title: "Shortcuts",
        summary: "在依賴操作習慣前，先確認目前快捷鍵設定。",
        mdxContent: `

使用 **Shortcuts** 來確認目前導覽和編輯相關的 key bindings。

![Screenshot_20260408_142829](/doc-assets/admin/1775629727189-1304fc3b-Screenshot_20260408_142829.png)

`,
      },
    },
  },
  {
    key: makeDocSectionKey("system-overview", "overview", DOC_SHARED_ALL),
    pageKey: "system-overview",
    slug: "overview",
    audienceRole: DOC_SHARED_ALL,
    sortOrder: 10,
    translations: {
      "en": {
        title: "System Overview",
        summary: "Understand what this system is for and how the manual is organized.",
        mdxContent: `

This system is used to manage datasets, distribute labeling work, review images, and track progress by role.

## How this manual is organized

- The left sidebar lists only the pages relevant to your role.
- Shared pages are limited to topics that really behave the same across roles.
- Page names stay in English so the manual matches the UI exactly.

## What this manual does

- Explains what each page is for
- Explains what actions are available on that page
- Explains what result to expect after each action
- Warns you before destructive or irreversible actions

## What this manual does not do

- It does not describe backend internals
- It does not replace role-specific operating rules
- It does not mix User, Dataset Manager, and Admin actions into one workflow

## Reading rule

Always follow the section written for your own role. If another role uses a page with different permissions, treat that as a different workflow.

`,
      },
      "zh-TW": {
        title: "System Overview",
        summary: "先了解這個系統的用途，以及手冊如何分角色整理。",
        mdxContent: `

這個系統用來管理 datasets、分配標註工作、檢查圖片，以及依角色追蹤進度。

## 這份手冊怎麼整理

- 左側目錄只會顯示你這個角色需要看的頁面
- 只有真正相同行為的頁面才會用 shared 文件
- 頁面名稱保留英文，讓手冊和 UI 一致

## 這份手冊會做什麼

- 說明每個頁面是做什麼的
- 說明這個頁面有哪些操作
- 說明每個操作完成後的結果
- 在破壞性或不可逆操作前先提醒你

## 這份手冊不做什麼

- 不講 backend 技術細節
- 不取代角色本身的作業規則
- 不會把 User、Dataset Manager、Admin 的操作混在一起

## 閱讀規則

請只依照自己角色的章節操作。如果另一個角色也能進同一頁，但權限和目的不同，就視為不同流程。

`,
      },
    },
  },
  {
    key: makeDocSectionKey("users", "admin", "admin"),
    pageKey: "users",
    slug: "admin",
    audienceRole: "admin",
    sortOrder: 10,
    translations: {
      "en": {
        title: "Users",
        summary: "Create, update, and deactivate accounts safely.",
        mdxContent: `

**Users** is admin-only.

![Screenshot_20260408_141932](/doc-assets/admin/1775629187699-ddfb6a9b-Screenshot_20260408_141932.png)

## Typical actions

- create user
- change role
- reset password
- deactivate account

<Warning title="Role changes take effect immediately" />

Changing a role changes what the user can see and do right away.

`,
      },
      "zh-TW": {
        title: "Users",
        summary: "安全建立、修改與停用帳號。",
        mdxContent: `

**Users** 是 admin 專用頁面。

![Screenshot_20260408_141932](/doc-assets/admin/1775629180941-c1a380f2-Screenshot_20260408_141932.png)

## 常見操作

- create user
- change role
- reset password
- deactivate account

<Warning title="角色變更會立即生效" />

角色變更後，使用者可見功能和可做操作會立刻改變。

`,
      },
    },
  },
  {
    key: makeDocSectionKey("viewer", "shared", DOC_SHARED_ALL),
    pageKey: "viewer",
    slug: "shared",
    audienceRole: DOC_SHARED_ALL,
    sortOrder: 10,
    translations: {
      "en": {
        title: "Viewer",
        summary: "Use Viewer to inspect images and labels without entering edit mode.",
        mdxContent: `

**Viewer** is shared because the core viewing behavior is the same across roles.

![Screenshot_20260408_142223](/doc-assets/admin/1775629356791-b1348429-Screenshot_20260408_142223.png)

## Use Viewer when

- you want to inspect images
- you want to verify labels
- you need to review a range before taking another action

## Do not assume

- that Viewer means you can edit
- that Viewer means you own the job

`,
      },
      "zh-TW": {
        title: "Viewer",
        summary: "用 Viewer 檢查圖片與標註，不進入編輯模式。",
        mdxContent: `

**Viewer** 是 shared，因為它的核心看圖行為在各角色之間是一樣的。

![Screenshot_20260408_142223](/doc-assets/admin/1775629364015-594fbbfc-Screenshot_20260408_142223.png)

## 什麼時候用 Viewer

- 想檢查圖片
- 想確認標註
- 想在做下一步前先看一段範圍

## 不要直接假設

- 開得了 Viewer 就代表可以編輯
- 開得了 Viewer 就代表這個 job 是你的

`,
      },
    },
  },
];

export function getInitialDocSections() {
  return sections;
}
