// Direct local download, independent of clipboard support and file-offer settings.
export function downloadFile(document, { text, mime, filename }) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  try {
    const link = document.createElement("a");
    try {
      link.href = url;
      link.download = filename;
      document.body.append(link);
      link.click();
    } finally {
      link.remove();
    }
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
}
