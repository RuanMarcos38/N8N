type Row=Record<string,any>;
async function request(method:string,url:string,body?:unknown){
 const r=await fetch(url,{method,credentials:'same-origin',headers:body===undefined?{}:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const data=await r.json();if(!r.ok){const e:any=new Error(data.error||data.message||'Não foi possível concluir.');e.response={data};throw e;}return {data};
}
export const api={get:(url:string)=>request('GET',url),post:(url:string,b?:unknown)=>request('POST',url,b),put:(url:string,b?:unknown)=>request('PUT',url,b),delete:(url:string,b?:unknown)=>request('DELETE',url,b)};
export const auth={getUser:async()=> (await api.get('/api/auth/user')).data.user as Row|null,signInWithRedirect:async()=>{location.href='/login'+(location.hash||'');},signOut:async()=>{await api.post('/api/auth/logout');location.href='/login';}};
export const invitesClient={
 getPendingCode:()=>{const q=new URLSearchParams(location.hash.split('?')[1]||location.search);const code=q.get('code');if(code)sessionStorage.setItem('salesos_invite',code);return sessionStorage.getItem('salesos_invite');},
 clearPendingCode:()=>sessionStorage.removeItem('salesos_invite'),
 buildJoinUrl:(code:string,_options?:Row)=>location.origin+'/#/join?code='+encodeURIComponent(code)
};
