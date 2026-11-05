import { useWork } from "./useWork";
// The mounted-view guard runs before creating a download, so a delayed response
// cannot open the old account's document after a sign-out or access refresh.
export function useCvDownload(){return useWork<Blob>(blob=>{const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;const ext=({'application/pdf':'.pdf','image/png':'.png','image/jpeg':'.jpg','application/vnd.openxmlformats-officedocument.wordprocessingml.document':'.docx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'.xlsx'} as Record<string,string>)[blob.type]??'';link.download='candidate-cv'+ext;link.click();URL.revokeObjectURL(url);});}
