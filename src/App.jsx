import { useEffect, useRef, useState } from "react";
import "./App.css";

import { Hub } from "aws-amplify/utils";
import { uploadData, list, getUrl, remove } from "aws-amplify/storage";

import {
  signInWithRedirect,
  signOut,
  getCurrentUser,
  fetchAuthSession,
} from "aws-amplify/auth";

// ✅ API Gateway URL
const API_BASE = "https://rxr3r0mmt8.execute-api.eu-north-1.amazonaws.com";

// ✅ helpers
const humanFileSize = (bytes) => {
  if (!bytes && bytes !== 0) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let s = bytes;
  let i = 0;
  while (s >= 1024 && i < units.length - 1) {
    s = s / 1024;
    i++;
  }
  const fixed = i === 0 ? 0 : s < 10 ? 2 : 1;
  return `${s.toFixed(fixed)} ${units[i]}`;
};

const safeJoinFolder = (folder, name) => {
  const clean = (name || "").trim().replace(/^\/+|\/+$/g, "");
  if (!clean) return folder || "";
  if (!folder) return clean;
  return `${folder.replace(/\/+$/g, "")}/${clean}`;
};

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  // ✅ user identity
  const [userSub, setUserSub] = useState("");
  const [userEmail, setUserEmail] = useState("");

  // UI states
  const fileInputRef = useRef(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);

  // File list
  const [files, setFiles] = useState([]);
  const [loadingFiles, setLoadingFiles] = useState(false);

  // ✅ Folder System
  const [currentFolder, setCurrentFolder] = useState("");
  const [newFolderName, setNewFolderName] = useState("");

  // ✅ Search + Sort
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState("latest");

  // ✅ Preview
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewFile, setPreviewFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewType, setPreviewType] = useState("");

  // ✅ Sharing Feature states
  const [activeTab, setActiveTab] = useState("myfiles"); // myfiles | requests | shared

  const [usersList, setUsersList] = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);

  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareFile, setShareFile] = useState(null);
  const [shareSending, setShareSending] = useState(false);

  const [requests, setRequests] = useState([]);
  const [reqLoading, setReqLoading] = useState(false);

  const [sharedWithMe, setSharedWithMe] = useState([]);
  const [sharedLoading, setSharedLoading] = useState(false);

  // ✅ API helper
  const api = async (path, options = {}) => {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(txt);
    }
    return res.json();
  };

  // ✅ Load files
  const loadFiles = async (sub, folder = "") => {
    try {
      if (!sub) return;
      setLoadingFiles(true);

      const folderPrefix = folder ? `${folder.replace(/\/+$/g, "")}/` : "";
      const result = await list({
        path: `uploads/${sub}/${folderPrefix}`,
      });

      setFiles(result.items || []);
    } catch (err) {
      console.log("List files error:", err);
    } finally {
      setLoadingFiles(false);
    }
  };

  // ✅ save user into DynamoDB Users table
  const upsertUserToDB = async (sub, email) => {
    try {
      if (!sub) return;
      await api("/users/upsert", {
        method: "POST",
        body: JSON.stringify({
          userSub: sub,
          email: email || "",
          name: email || sub,
        }),
      });
    } catch (e) {
      console.log("upsertUserToDB error:", e);
    }
  };

  // ✅ load users list
  const loadUsers = async (subParam) => {
    try {
      const mySub = subParam || userSub;
      if (!mySub) return;

      setUsersLoading(true);
      const data = await api("/users/list");
      const arr = data.users || [];
      setUsersList(arr.filter((u) => u.userSub !== mySub)); // exclude me
    } catch (e) {
      console.log("loadUsers error:", e);
      alert("Users list loading failed ");
    } finally {
      setUsersLoading(false);
    }
  };

  // ✅ requests for me
  const loadRequests = async (subParam) => {
    try {
      if (!subParam) return;
      setReqLoading(true);
      const data = await api(`/share/requests?toSub=${encodeURIComponent(subParam)}`);
      setRequests(data.requests || []);
    } catch (e) {
      console.log("loadRequests error:", e);
    } finally {
      setReqLoading(false);
    }
  };

  // ✅ shared with me
  const loadSharedWithMe = async (subParam) => {
    try {
      if (!subParam) return;
      setSharedLoading(true);
      const data = await api(`/share/shared-with-me?toSub=${encodeURIComponent(subParam)}`);
      setSharedWithMe(data.items || []);
    } catch (e) {
      console.log("loadSharedWithMe error:", e);
    } finally {
      setSharedLoading(false);
    }
  };

  // ✅ On App Load → check Amplify current session
  useEffect(() => {
    let unsub;

    const init = async () => {
      try {
        // ✅ finish redirect flow + session
        const session = await fetchAuthSession();

        const user = await getCurrentUser();
        const sub = user?.userId;
        if (!sub) throw new Error("No sub");

        // ✅ MOST RELIABLE: email from token payload
        const idPayload = session?.tokens?.idToken?.payload || {};
        const accessPayload = session?.tokens?.accessToken?.payload || {};

        const email =
          idPayload.email ||
          accessPayload.email ||
          idPayload["cognito:username"] ||
          user?.username ||
          "";

        setIsLoggedIn(true);
        setUserSub(sub);
        setUserEmail(email);

        await upsertUserToDB(sub, email);

        setCurrentFolder("");
        await loadFiles(sub, "");
        await loadRequests(sub);
        await loadSharedWithMe(sub);
      } catch (e) {
        setIsLoggedIn(false);
      }
    };

    // ✅ Listen auth events
    unsub = Hub.listen("auth", ({ payload }) => {
      if (payload?.event === "signedIn" || payload?.event === "signInWithRedirect") {
        init();
      }
      if (payload?.event === "signedOut") {
        setIsLoggedIn(false);
        setUserSub("");
        setUserEmail("");
        setFiles([]);
      }
    });

    init();

    return () => {
      if (unsub) unsub();
    };
  }, []);

  // ✅ auto refresh requests when userSub becomes available
  useEffect(() => {
    if (!userSub) return;
    loadRequests(userSub);
    loadSharedWithMe(userSub);
  }, [userSub]);

  // ✅ LOGIN via Amplify Hosted UI
  const handleLogin = async () => {
    try {
      await signInWithRedirect({ provider: "COGNITO" });
    } catch (e) {
      if ((e?.message || "").toLowerCase().includes("already")) {
        window.location.reload();
        return;
      }
      console.log("LOGIN ERROR:", e);
      alert("Login error: " + (e?.message || "unknown"));
    }
  };

  // ✅ LOGOUT (Localhost)
  const handleLogout = async () => {
    try {
      await signOut({ global: true });
      window.location.href = "https://file-sharing-app-with-aws-cloud.vercel.app/";
    } catch (e) {
      console.log(e);
      alert("Logout failed ");
    }
  };

  // file picker
  const openFilePicker = () => fileInputRef.current?.click();

  const onFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) setSelectedFile(file);
  };

  // ✅ upload
  const uploadToS3 = async () => {
    if (!selectedFile) return;

    try {
      setUploading(true);

      const targetPath = safeJoinFolder(
        safeJoinFolder(`uploads/${userSub}`, currentFolder),
        selectedFile.name
      );

      const result = await uploadData({
        path: targetPath,
        data: selectedFile,
      }).result;

      setSelectedFile(null);
      alert("Uploaded....!\n" + result.path);

      loadFiles(userSub, currentFolder);
    } catch (err) {
      console.log("Upload error:", err);
      alert("Upload failed");
    } finally {
      setUploading(false);
    }
  };

  // ✅ preview
  const openPreview = async (fileItem) => {
    try {
      setPreviewLoading(true);
      setPreviewOpen(true);
      setPreviewFile(fileItem);
      setPreviewUrl("");

      const urlRes = await getUrl({ path: fileItem.path });
      const url = urlRes.url.toString();
      setPreviewUrl(url);

      const name = (fileItem._name || "").toLowerCase();

      if (/\.(png|jpg|jpeg|gif|webp|bmp|svg)$/.test(name)) setPreviewType("image");
      else if (/\.(pdf)$/.test(name)) setPreviewType("pdf");
      else if (/\.(mp4|webm|ogg)$/.test(name)) setPreviewType("video");
      else if (/\.(mp3|wav|aac|m4a)$/.test(name)) setPreviewType("audio");
      else if (/\.(txt|json|md|csv)$/.test(name)) setPreviewType("text");
      else setPreviewType("other");
    } catch (e) {
      console.log(e);
      alert("Preview failed ");
      setPreviewOpen(false);
    } finally {
      setPreviewLoading(false);
    }
  };

  // ✅ share modal
  const openShareModal = async (fileItem) => {
    setShareFile(fileItem);
    setShareModalOpen(true);
    await loadUsers(userSub);
  };

  const sendShareRequest = async (u) => {
    if (!shareFile) return;

    try {
      setShareSending(true);

      const fileName =
        shareFile._name || shareFile.path.replace(`uploads/${userSub}/`, "");

      await api("/share/request", {
        method: "POST",
        body: JSON.stringify({
          fromSub: userSub,
          fromEmail: userEmail || userSub, // ✅ FIXED (no unknown)
          toSub: u.userSub,
          toEmail: u.email,
          filePath: shareFile.path,
          fileName,
        }),
      });

      alert(`Request sent ✅ to ${u.email}`);
      setShareModalOpen(false);

      loadRequests(userSub);
    } catch (e) {
      console.log(e);
      alert("Share request failed ");
    } finally {
      setShareSending(false);
    }
  };

  const acceptReq = async (req) => {
    try {
      await api("/share/accept", {
        method: "POST",
        body: JSON.stringify({
          toSub: userSub,
          requestId: req.requestId,
        }),
      });

      alert("Accepted ");
      loadRequests(userSub);
      loadSharedWithMe(userSub);
    } catch (e) {
      console.log(e);
      alert("Accept failed ");
    }
  };

  const rejectReq = async (req) => {
    try {
      await api("/share/reject", {
        method: "POST",
        body: JSON.stringify({
          toSub: userSub,
          requestId: req.requestId,
        }),
      });

      alert("Rejected ");
      loadRequests(userSub);
    } catch (e) {
      console.log(e);
      alert("Reject failed ");
    }
  };

  // ✅ Landing page
  if (!isLoggedIn) {
    return (
      <div className="page">
        <header className="header">
          <h1>Cloud File Storage & Sharing</h1>
          <p>AWS Cloud based secure file sharing portal</p>
        </header>

        <main className="card">
          <h2>Welcome </h2>
          <p>
            <b>Secure login for file upload/download/share</b>
          </p>

          <button className="btn" onClick={handleLogin}>
            Login / Sign Up
          </button>
        </main>

        <footer className="footer">
          <p>Made by Dinesh Malode</p>
          <p> • AWS Project</p>
        </footer>
      </div>
    );
  }

  // ✅ dashboard view parsing
  const folderPrefixForUI = currentFolder
    ? `${currentFolder.replace(/\/+$/g, "")}/`
    : "";

  const folderSet = new Set();
  const fileItems = [];

  (files || []).forEach((item) => {
    const relative = item.path.replace(`uploads/${userSub}/`, "");

    const rel =
      folderPrefixForUI && relative.startsWith(folderPrefixForUI)
        ? relative.slice(folderPrefixForUI.length)
        : relative;

    if (!rel) return;

    if (rel.includes("/")) {
      const folderName = rel.split("/")[0];
      if (folderName) folderSet.add(folderName);
    } else {
      fileItems.push({ ...item, _name: rel });
    }
  });

  const folders = Array.from(folderSet).sort((a, b) => a.localeCompare(b));

  const filteredFiles = fileItems.filter((f) =>
    (f._name || "").toLowerCase().includes(searchQuery.trim().toLowerCase())
  );

  const sortedFiles = [...filteredFiles].sort((a, b) => {
    const nameA = (a._name || "").toLowerCase();
    const nameB = (b._name || "").toLowerCase();
    const sizeA = a.size || 0;
    const sizeB = b.size || 0;
    const timeA = a.lastModified ? new Date(a.lastModified).getTime() : 0;
    const timeB = b.lastModified ? new Date(b.lastModified).getTime() : 0;

    if (sortBy === "name_az") return nameA.localeCompare(nameB);
    if (sortBy === "name_za") return nameB.localeCompare(nameA);
    if (sortBy === "size_asc") return sizeA - sizeB;
    if (sortBy === "size_desc") return sizeB - timeA;
    return timeB - timeA;
  });

  const totalBytes = fileItems.reduce((sum, f) => sum + (f.size || 0), 0);
  const quotaBytes = 1024 * 1024 * 1024;
  const usagePct = Math.min(100, Math.round((totalBytes / quotaBytes) * 100));

  const pendingReq = (requests || []).filter((r) => r.status === "PENDING");

  return (
    <div className="page">
      <header className="header">
        <h1>Dashboard</h1>
        <p style={{ opacity: 0.9 }}>
          Welcome back  <br />
          <span style={{ fontSize: "13px", opacity: 0.8 }}>
            {userEmail || userSub}
          </span>
        </p>
      </header>

      <main className="card">
        {/* Tabs */}
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "14px" }}>
          <button className={`btn ${activeTab === "myfiles" ? "" : "secondary"}`} onClick={() => setActiveTab("myfiles")}>
            My Files
          </button>

          <button
            className={`btn ${activeTab === "requests" ? "" : "secondary"}`}
            onClick={() => {
              setActiveTab("requests");
              loadRequests(userSub);
            }}
          >
            Requests ({pendingReq.length})
          </button>

          <button
            className={`btn ${activeTab === "shared" ? "" : "secondary"}`}
            onClick={() => {
              setActiveTab("shared");
              loadSharedWithMe(userSub);
            }}
          >
            Shared With Me ({sharedWithMe.length})
          </button>
        </div>

        {/*  My Files */}
        {activeTab === "myfiles" && (
          <>
            <h2>My Files</h2>

            {/* Storage usage */}
            <div className="softCard" style={{ marginTop: "14px", textAlign: "left" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "12px" }}>
                <div style={{ fontWeight: 800 }}>Storage Usage</div>
                <div style={{ opacity: 0.85, fontSize: "13px" }}>
                  {humanFileSize(totalBytes)} / {humanFileSize(quotaBytes)}
                </div>
              </div>

              <div className="progressBar" style={{ marginTop: "10px" }}>
                <div className="progressFill" style={{ width: `${usagePct}%` }}></div>
              </div>
              <div style={{ marginTop: "8px", fontSize: "13px", opacity: 0.85 }}>
                {usagePct}% used
              </div>
            </div>

            {/* Upload */}
            <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap", marginTop: "14px" }}>
              <input ref={fileInputRef} type="file" style={{ display: "none" }} onChange={onFileChange} />
              <button className="btn" onClick={openFilePicker}>
                Select File
              </button>

              <div style={{ opacity: 0.9, fontWeight: "bold" }}>
                {selectedFile ? selectedFile.name : "No file selected"}
              </div>

              <button className="btn" onClick={uploadToS3} disabled={!selectedFile || uploading}>
                {uploading ? "Uploading..." : "Upload to S3"}
              </button>
            </div>

            {/* Files */}
            <div style={{ marginTop: "18px", textAlign: "left" }}>
              <h3 style={{ marginBottom: "10px" }}>Uploaded Files</h3>

              <button className="btn" onClick={() => loadFiles(userSub, currentFolder)} disabled={loadingFiles}>
                {loadingFiles ? "Loading..." : "Refresh Files"}
              </button>

              <div style={{ marginTop: "12px" }}>
                {sortedFiles.length === 0 ? (
                  <p style={{ opacity: 0.8 }}>No files uploaded yet.</p>
                ) : (
                  sortedFiles.map((f) => (
                    <div
                      key={f.path}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: "10px",
                        padding: "10px",
                        border: "1px solid rgba(255,255,255,0.15)",
                        borderRadius: "12px",
                        marginBottom: "10px",
                      }}
                    >
                      <div style={{ flex: 1, overflow: "hidden" }}>
                        <div style={{ fontWeight: "bold", wordBreak: "break-all" }}>{f._name}</div>
                        <div style={{ opacity: 0.75, fontSize: "13px" }}>{f.size ? humanFileSize(f.size) : ""}</div>
                      </div>

                      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                        <button className="btn secondary" style={{ padding: "8px 10px" }} onClick={() => openPreview(f)}>
                          Preview
                        </button>

                        <button className="btn secondary" style={{ padding: "8px 10px" }} onClick={() => openShareModal(f)}>
                          Share
                        </button>

                        <button
                          className="btn"
                          style={{ padding: "8px 10px" }}
                          onClick={async () => {
                            const urlRes = await getUrl({ path: f.path });
                            window.open(urlRes.url.toString(), "_blank");
                          }}
                        >
                          Download
                        </button>

                        <button
                          className="btn"
                          style={{ background: "#ef4444", padding: "8px 10px" }}
                          onClick={async () => {
                            const ok = confirm("Delete file?");
                            if (!ok) return;
                            await remove({ path: f.path });
                            loadFiles(userSub, currentFolder);
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </>
        )}

        {/*  Requests */}
        {activeTab === "requests" && (
          <div style={{ textAlign: "left" }}>
            <h2>Share Requests</h2>
            <button className="btn" onClick={() => loadRequests(userSub)} disabled={reqLoading}>
              {reqLoading ? "Loading..." : "Refresh Requests"}
            </button>

            <div style={{ marginTop: "14px" }}>
              {requests.length === 0 ? (
                <p style={{ opacity: 0.8 }}>No requests.</p>
              ) : (
                requests.map((r) => (
                  <div
                    key={r.requestId}
                    style={{
                      padding: "12px",
                      borderRadius: "14px",
                      border: "1px solid rgba(255,255,255,0.15)",
                      marginBottom: "10px",
                    }}
                  >
                    <div style={{ fontWeight: 900 }}>
                      {r.fileName}{" "}
                      <span style={{ fontSize: "13px", opacity: 0.8 }}>({r.status})</span>
                    </div>
                    <div style={{ opacity: 0.8, fontSize: "13px" }}>
                      From: {r.fromEmail || r.fromSub}
                    </div>

                    {r.status === "PENDING" ? (
                      <div style={{ marginTop: "10px", display: "flex", gap: "10px", flexWrap: "wrap" }}>
                        <button className="btn" onClick={() => acceptReq(r)}>
                          Accept
                        </button>
                        <button className="btn" style={{ background: "#ef4444" }} onClick={() => rejectReq(r)}>
                          Reject
                        </button>
                      </div>
                    ) : (
                      <div style={{ marginTop: "10px", opacity: 0.8, fontSize: "13px" }}>Action taken </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/*  Shared with me */}
        {activeTab === "shared" && (
          <div style={{ textAlign: "left" }}>
            <h2>Shared With Me</h2>
            <button className="btn" onClick={() => loadSharedWithMe(userSub)} disabled={sharedLoading}>
              {sharedLoading ? "Loading..." : "Refresh Shared Files"}
            </button>

            <div style={{ marginTop: "14px" }}>
              {sharedWithMe.length === 0 ? (
                <p style={{ opacity: 0.8 }}>No shared files.</p>
              ) : (
                sharedWithMe.map((it) => (
                  <div
                    key={it.filePath}
                    style={{
                      padding: "12px",
                      borderRadius: "14px",
                      border: "1px solid rgba(255,255,255,0.15)",
                      marginBottom: "10px",
                      display: "flex",
                      justifyContent: "space-between",
                      gap: "10px",
                      flexWrap: "wrap",
                      alignItems: "center",
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 900 }}>{it.fileName}</div>
                      <div style={{ opacity: 0.8, fontSize: "13px" }}>From: {it.fromEmail || it.fromSub}</div>
                    </div>

                    <button
                      className="btn"
                      onClick={async () => {
                        try {
                          const urlRes = await getUrl({ path: it.filePath });
                          window.open(urlRes.url.toString(), "_blank");
                        } catch (e) {
                          console.log(e);
                          alert("Cannot open shared file ");
                        }
                      }}
                    >
                      Open / Download
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        <button className="btn" style={{ background: "#ef4444", marginTop: "18px" }} onClick={handleLogout}>
          Logout
        </button>
      </main>

      <footer className="footer">
        <p>Secure Cloud Portal • AWS</p>
      </footer>

      {/* Preview Modal */}
      {previewOpen && (
        <div className="modalOverlay" onClick={() => setPreviewOpen(false)}>
          <div className="modalCard" onClick={(e) => e.stopPropagation()}>
            <div className="modalHeader">
              <div style={{ fontWeight: 900 }}>Preview: {previewFile?._name}</div>
              <button className="btn secondary" onClick={() => setPreviewOpen(false)}>
                Close ✖
              </button>
            </div>

            {previewLoading ? (
              <div style={{ padding: "14px", opacity: 0.85 }}>Loading preview...</div>
            ) : (
              <div className="modalBody">
                {previewType === "image" && (
                  <img src={previewUrl} alt="preview" style={{ maxWidth: "100%", borderRadius: "12px" }} />
                )}
                {previewType === "pdf" && (
                  <iframe title="pdf" src={previewUrl} style={{ width: "100%", height: "70vh", border: "0" }} />
                )}
                {previewType === "video" && (
                  <video controls src={previewUrl} style={{ width: "100%", borderRadius: "12px" }} />
                )}
                {previewType === "audio" && <audio controls src={previewUrl} style={{ width: "100%" }} />}
                {previewType === "text" && (
                  <iframe title="text" src={previewUrl} style={{ width: "100%", height: "60vh", border: "0" }} />
                )}
                {previewType === "other" && (
                  <div style={{ opacity: 0.9 }}>
                    Preview not supported.
                    <div style={{ marginTop: "10px" }}>
                      <button className="btn" onClick={() => window.open(previewUrl, "_blank")}>
                        Open File
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Share Modal */}
      {shareModalOpen && (
        <div className="modalOverlay" onClick={() => setShareModalOpen(false)}>
          <div className="modalCard" onClick={(e) => e.stopPropagation()}>
            <div className="modalHeader">
              <div style={{ fontWeight: 900 }}>Share: {shareFile?._name || shareFile?.path}</div>
              <button className="btn secondary" onClick={() => setShareModalOpen(false)}>
                Close ✖
              </button>
            </div>

            <div className="modalBody" style={{ textAlign: "left" }}>
              <h3 style={{ marginTop: 0 }}>Select user</h3>

              <button className="btn secondary" onClick={() => loadUsers(userSub)} disabled={usersLoading}>
                {usersLoading ? "Loading..." : "Refresh Users"}
              </button>

              <div style={{ marginTop: "12px" }}>
                {usersList.length === 0 ? (
                  <p style={{ opacity: 0.8 }}>No users found. (Other users must login at least 1 time)</p>
                ) : (
                  usersList.map((u) => (
                    <div
                      key={u.userSub}
                      style={{
                        padding: "10px",
                        borderRadius: "12px",
                        border: "1px solid rgba(255,255,255,0.15)",
                        marginBottom: "10px",
                        display: "flex",
                        justifyContent: "space-between",
                        gap: "10px",
                        alignItems: "center",
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 900 }}>{u.email}</div>
                        <div style={{ fontSize: "13px", opacity: 0.75 }}>sub: {u.userSub}</div>
                      </div>

                      <button className="btn" disabled={shareSending} onClick={() => sendShareRequest(u)}>
                        {shareSending ? "Sending..." : "Send Request"}
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
