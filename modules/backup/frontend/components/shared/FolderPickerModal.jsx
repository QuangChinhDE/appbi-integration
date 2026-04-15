import React from 'react'
import { Globe, Folder, ChevronRight, Loader2 } from 'lucide-react'
import { Modal, SpinCenter, Empty, Alert, Tag } from '@packages/ui/src/components/common/ui'

const FolderPickerModal = ({ wizard }) => {
  const {
    googleFolderModal, setGoogleFolderModal,
    drives, loadingDrives, currentDriveId,
    folders, folderPath, loadingFolders,
    isServiceAccountDestinationAuth,
    sharedFolders, loadingSharedFolders,
    sharedFolderQuery, setSharedFolderQuery,
    sharedFolderReference, setSharedFolderReference,
    resolvingSharedFolder,
    handleDriveChange, handleOpenSubFolder, handleBreadcrumbNav,
    handleSelectCurrentFolder, handleResolveSharedFolder,
    loadSharedFolders, applyGoogleFolderSelection, openFolderLocation,
    resolveDriveName,
  } = wizard

  return (
    <Modal
      title={<span className="flex items-center gap-2"><Globe className="w-4 h-4 text-blue-500" /> Select Google Drive Folder</span>}
      open={googleFolderModal}
      onCancel={() => setGoogleFolderModal(false)}
      width={540}
      footer={
        <>
          <button onClick={() => setGoogleFolderModal(false)} className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50">Cancel</button>
          <button onClick={handleSelectCurrentFolder} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 flex items-center gap-2">
            <Folder className="w-3.5 h-3.5" /> Select Current Location
          </button>
        </>
      }
    >
      {loadingDrives ? <SpinCenter text="Loading drives…" /> : (
        <div className="space-y-3">
          {drives.length > 1 && (
            <select value={currentDriveId} onChange={e => handleDriveChange(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              {drives.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          )}

          {/* Breadcrumb */}
          <div className="bg-gray-50 rounded-md px-3 py-2 flex flex-wrap gap-1 items-center text-xs">
            {folderPath.map((item, idx) => (
              <span key={item.id} className="flex items-center gap-1">
                {idx > 0 && <ChevronRight className="w-3 h-3 text-gray-400" />}
                <span onClick={() => idx < folderPath.length - 1 && handleBreadcrumbNav(idx)}
                  className={idx === folderPath.length - 1 ? 'font-semibold text-gray-900' : 'text-blue-600 cursor-pointer hover:underline'}>
                  {item.name}
                </span>
              </span>
            ))}
          </div>

          {/* Service account shared folders */}
          {isServiceAccountDestinationAuth && (
            <div className="space-y-2">
              <div className="border-t border-gray-200 pt-2">
                <p className="text-xs font-medium text-gray-500 mb-2">Shared to this service account</p>
                <Alert type="info" message="Need a directly shared folder?" description="Paste a folder link or search below. Only 'Shared Drive' folders can be used as backup destination." className="mb-2" />
                <div className="flex gap-2 mb-2">
                  <input value={sharedFolderReference} onChange={e => setSharedFolderReference(e.target.value)}
                    placeholder="Paste Google Drive folder link or ID"
                    className="flex-1 border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  <button onClick={handleResolveSharedFolder} disabled={resolvingSharedFolder}
                    className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1">
                    {resolvingSharedFolder ? <Loader2 className="w-3 h-3 animate-spin" /> : null} Use folder
                  </button>
                </div>
                <div className="flex gap-2">
                  <input value={sharedFolderQuery} onChange={e => setSharedFolderQuery(e.target.value)}
                    placeholder="Search shared folders…"
                    className="flex-1 border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  <button onClick={() => loadSharedFolders(sharedFolderQuery.trim())} disabled={loadingSharedFolders}
                    className="px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50">Search</button>
                </div>
              </div>
              <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-lg">
                {loadingSharedFolders ? <SpinCenter text="Loading…" /> : sharedFolders.length === 0 ? <Empty description="No directly shared folders found" /> : sharedFolders.map(folder => (
                  <div key={folder.id} className="flex items-center gap-3 px-3 py-2.5 border-b border-gray-100 last:border-0">
                    <Folder className="w-4 h-4 text-amber-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{folder.name}</div>
                      <div className="text-xs text-gray-500">Drive: {resolveDriveName(folder.drive_id, folder.drive_name || null)}</div>
                      <div className="flex gap-1 mt-1">
                        <Tag color="blue">Direct share</Tag>
                        {folder.drive_id ? <Tag color="green">Shared Drive</Tag> : <Tag color="gold">My Drive only</Tag>}
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button onClick={() => openFolderLocation(folder)} className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50">Open</button>
                      {folder.drive_id
                        ? <button onClick={() => applyGoogleFolderSelection(folder)} className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700">Use</button>
                        : <button disabled title="Cannot use My Drive folder with service account" className="px-2 py-1 text-xs bg-blue-200 text-white rounded opacity-50 cursor-not-allowed">Use</button>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Folder list */}
          <div className={`overflow-y-auto border border-gray-200 rounded-lg ${isServiceAccountDestinationAuth ? 'max-h-48' : 'max-h-72'}`}>
            {loadingFolders ? <SpinCenter text="Loading folders…" /> : folders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-gray-400">
                <Folder className="w-8 h-8 mb-2 opacity-30" />
                <p className="text-sm">No sub-folders here</p>
              </div>
            ) : folders.map(folder => (
              <button key={folder.id} onClick={() => handleOpenSubFolder(folder)}
                className="w-full flex items-center gap-3 px-3 py-2.5 border-b border-gray-100 last:border-0 hover:bg-gray-50 transition-colors text-left">
                <Folder className="w-4 h-4 text-amber-500 shrink-0" />
                <span className="flex-1 text-sm">{folder.name}</span>
                <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
              </button>
            ))}
          </div>
        </div>
      )}
    </Modal>
  )
}

export default FolderPickerModal
