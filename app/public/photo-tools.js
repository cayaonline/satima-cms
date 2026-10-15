(()=>{
 const limit=10*1024*1024;
 const accepted=new Set(['image/jpeg','image/png','image/webp']);
 async function decode(file){
  const url=URL.createObjectURL(file);
  try{return await new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('Image could not be processed. Choose another photo.'));image.src=url;});}
  finally{URL.revokeObjectURL(url);}
 }
 async function prepare(file){
  if(!file||!file.size)throw new Error('Choose a photograph.');
  if(file.size>limit)throw new Error('File exceeds the 10 MB upload limit. Choose a smaller photo.');
  const heic=/\.(heic|heif)$/i.test(file.name||'')||/image\/hei[cf]/i.test(file.type||'');
  const extension=(file.name||'').toLowerCase().match(/\.(jpe?g|png|webp)$/)?.[1];
  const inferred=extension==='jpg'||extension==='jpeg'?'image/jpeg':extension==='png'?'image/png':extension==='webp'?'image/webp':null;
  const mime=accepted.has(file.type)?file.type:!file.type?inferred:null;
  if(!mime&&!heic)throw new Error('Unsupported image format. Choose JPEG, PNG, WebP, or a HEIC photo supported by this device.');
  if(!heic&&file.size<=2*1024*1024)return mime===file.type?file:new File([file],file.name,{type:mime});
  let image;try{image=await decode(file);}catch(error){if(heic)throw new Error('This browser cannot process HEIC photos. Choose JPEG or use your camera’s compatible format.');throw error;}
  if(!image.naturalWidth||!image.naturalHeight)throw new Error('Image could not be processed.');
  const scale=Math.min(1,2200/Math.max(image.naturalWidth,image.naturalHeight));
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
  canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.88));canvas.width=canvas.height=0;
  if(!blob)throw new Error('Image could not be processed. Please retry.');
  if(blob.size>limit)throw new Error('Optimized image still exceeds 10 MB. Choose a smaller photo.');
  return new File([blob],(file.name||'photo').replace(/\.(heic|heif|png|webp|jpe?g)$/i,'')+'.jpg',{type:'image/jpeg'});
 }
 window.satimaPhoto={prepare,maxBytes:limit};
})();
