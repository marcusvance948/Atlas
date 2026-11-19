// --- minimal SHA-256 that returns Java-style signed bytes, like Utilities.computeDigest
function sha256(str){function r(n,x){return(x>>>n)|(x<<(32-n))}var K=[],H=[],p=2,c=0;function isP(n){for(var f=2;f*f<=n;f++)if(n%f==0)return false;return true}
 while(c<64){if(isP(p)){if(c<8)H[c]=(Math.pow(p,1/2)*4294967296)|0;K[c]=(Math.pow(p,1/3)*4294967296)|0;c++}p++}
 var b=unescape(encodeURIComponent(str)),w=[],l=b.length*8,i,j;for(i=0;i<b.length;i++)w[i>>2]|=b.charCodeAt(i)<<(24-(i%4)*8);w[l>>5]|=0x80<<(24-l%32);w[((l+64>>9)<<4)+15]=l;
 for(j=0;j<w.length;j+=16){var a=H.slice(0),W=[];for(i=0;i<64;i++){if(i<16)W[i]=w[j+i]|0;else{var s0=r(7,W[i-15])^r(18,W[i-15])^(W[i-15]>>>3),s1=r(17,W[i-2])^r(19,W[i-2])^(W[i-2]>>>10);W[i]=(W[i-16]+s0+W[i-7]+s1)|0}
  var t1=(a[7]+(r(6,a[4])^r(11,a[4])^r(25,a[4]))+((a[4]&a[5])^(~a[4]&a[6]))+K[i]+W[i])|0,t2=((r(2,a[0])^r(13,a[0])^r(22,a[0]))+((a[0]&a[1])^(a[0]&a[2])^(a[1]&a[2])))|0;a=[(t1+t2)|0].concat(a);a[4]=(a[4]+t1)|0;a.pop()}
  for(i=0;i<8;i++)H[i]=(H[i]+a[i])|0}
 var out=[];for(i=0;i<8;i++)for(var k=3;k>=0;k--){var v=(H[i]>>(k*8))&255;out.push(v>127?v-256:v)}return out}
var Utilities={DigestAlgorithm:{SHA_256:1},Charset:{UTF_8:1},computeDigest:function(a,s){return sha256(s)},formatDate:function(d,tz,f){return f==="H"?"5":f==="u"?"6":"2026-11-14"}};
var ScriptApp={getOAuthToken:function(){return"t"}},Logger={log:function(){}};
var SRC=$.NSString.stringWithContentsOfFileEncodingError("Code.gs",4,null).js;
eval(SRC);
var out=[];function check(name,ok,extra){out.push((ok?"PASS ":"FAIL ")+name+(extra?"  "+extra:""))}
check("hash matches the site", gh_("2026-11-13","4")==="bcbb2689d9e114b7c3c06ce7", gh_("2026-11-13","4"));
// --- fake database
var H=function(d){return gh_(d,"4")};
var DB={games:[],gamevotes:[],plays:[],gamekeys:[],scores:[],signups:[],replies:[],posts:[],challenges:[],predictions:[]};
["2026-11-06","2026-11-09","2026-11-11","2026-11-12","2026-11-13"].forEach(function(d){DB.games.push({id:d,date:d,type:"quiz",title:"Quiz",points:10,items:[{q:"2+2",h:[H(d)]}],awarded:d<"2026-11-12"})});
DB.games.push({id:"2026-11-10",date:"2026-11-10",type:"versus",q:"Pizza or tacos",points:10});
var p1={id:"stu1",name:"Priya",grade:"11",g:{}};["2026-11-06","2026-11-09","2026-11-11","2026-11-12","2026-11-13"].forEach(function(d){p1.g[d]={r:{0:{ok:true,n:1,t:"4"}}}});
var p2={id:"stu2",name:"Marcus",grade:"9",g:{"2026-11-12":{r:{0:{t:"Four"}}},"2026-11-13":{r:{0:{t:"4"}}}}};
var p3={id:"stu3",name:"Dani",grade:"12",g:{"2026-11-13":{r:{0:{t:"5"}}}}};
DB.plays=[p1,p2,p3];
DB.gamevotes=[{id:"stu1",name:"Priya",grade:"11",v:{"2026-11-10":{pick:"a"}}},{id:"stu2",name:"Marcus",grade:"9",v:{"2026-11-10":{pick:"a"}}},{id:"stu3",name:"Dani",grade:"12",v:{"2026-11-10":{pick:"b"}}}];
var WRITES=[];list_=function(c){return JSON.parse(JSON.stringify(DB[c]||[]))};commit_=function(w){WRITES=WRITES.concat(w)};call_=function(){return null};
var msg=settle();
var W={};WRITES.forEach(function(w){var n=w.update.name.split("/documents/")[1];W[n]={fields:decFields_(w.update.fields),mask:(w.updateMask||{}).fieldPaths}});
var s1=W["scores/stu1"],s2=W["scores/stu2"],s3=W["scores/stu3"];
check("settle message",/settled 2026-11-10, 2026-11-12, 2026-11-13 for 2 students/.test(msg),msg);
check("Priya: versus win 10, quiz 10+10, +5 streak on the 12th", s1&&s1.fields.log["g2026-11-10"].p===10&&s1.fields.log["g2026-11-12"].p===10&&s1.fields.log["s2026-11-12"].p===5&&s1.fields.log["g2026-11-13"].p===10&&!s1.fields.log["s2026-11-13"], JSON.stringify(s1&&s1.fields.log));
check("Marcus: versus 10, 'Four' is not '4' (same as the site), quiz 13", s2&&s2.fields.log["g2026-11-10"].p===10&&!s2.fields.log["g2026-11-12"]&&s2.fields.log["g2026-11-13"].p===10&&!s2.fields.log["s2026-11-12"], JSON.stringify(s2&&s2.fields.log));
check("Dani: wrong answer and lost the vote, no points", !s3, s3?JSON.stringify(s3.fields.log):"");
check("field paths quoted for the update mask", s1&&s1.mask.indexOf("log.`g2026-11-12`")>=0, s1&&s1.mask.join(" "));
check("dates saved on new points", s1&&s1.fields.log["g2026-11-13"].d==="2026-11-13");
check("versus result a wins 2-1", W["games/2026-11-10"].fields.result.win==="a"&&W["games/2026-11-10"].fields.result.a===2);
check("quiz result 13: 2 solved of 3 played", W["games/2026-11-13"].fields.result.solved===2&&W["games/2026-11-13"].fields.result.played===3, JSON.stringify(W["games/2026-11-13"].fields.result));
check("games marked awarded", W["games/2026-11-12"].fields.awarded===true);
check("already-awarded games untouched", !W["games/2026-11-11"]);
// --- summary
DB.scores=[{id:"stu1",name:"Priya",grade:"11",log:{"g2026-11-03":{p:30},"g2026-11-10":{p:10,d:"2026-11-10"},["b"+(new Date(2026,10,11).getTime()).toString(36)]:{p:25,why:"Spirit"}}},{id:"grade-9",name:"Grade 9 bonus",grade:"9",team:true,log:{b1:{p:50}}},{id:"_settings",goal:500},{id:"stu2",name:"Marcus",grade:"9",log:{"g2026-11-12":{p:10}}}];
DB.signups=[{id:"stu1",hearts:{post1:true},events:{ev1:{at:"x"}}},{id:"stu2",hearts:{post1:true,post2:false},events:{ev1:{at:"y"}}}];
DB.posts=[{id:"post1",by:"stu1",title:"Lunch"}];DB.replies=[{id:"stu2",items:{r1:{postId:"post1",text:"agree",at:"2026-11-12T10:00:00Z",name:"Marcus"}}},{id:"stu1",items:{r2:{postId:"post1",text:"thanks",at:"2026-11-12T11:00:00Z",name:"Priya"}}}];
WRITES=[];writeStats();var st=decFields_(WRITES[0].update.fields);
check("likes counted (false ignored)", st.hearts.post1===2&&!st.hearts.post2);
check("sign-ups and replies counted", st.signups.ev1===2&&st.replies.post1===2);
check("reply notes only from other people", st.replyNotes.stu1.length===1&&st.replyNotes.stu1[0].name==="Marcus");
check("grade totals include grade bonuses", st.grades["11"]===65&&st.grades["9"]===60, JSON.stringify(st.grades));
check("this week (Nov 9 to 15) uses dates, bonus timestamp and key", st.week.ws==="2026-11-09"&&st.week.rank[0].id==="stu1"&&st.week.rank[0].pts===35&&st.week.rank[1].pts===10, JSON.stringify(st.week));
check("last week ranks", st.lastWeek.ws==="2026-11-02"&&st.lastWeek.rank[0].pts===30, JSON.stringify(st.lastWeek));
check("_settings and team docs not players", st.players.every(function(p){return p.id.charAt(0)!=="_"&&p.id!=="grade-9"}));
out.join("\n");
// --- morning push
var PUSHES=[];UrlFetchApp={fetch:function(u,o){var m=JSON.parse(o.payload).message;PUSHES.push(m);var dead=m.token==="dead";return{getResponseCode:function(){return dead?404:200},getContentText:function(){return dead?"UNREGISTERED":"{}"}}}};
DB.games.forEach(function(g){g.awarded=true});DB.games.push({id:"2026-11-14",date:"2026-11-14",type:"quiz",title:"Saturday special",items:[]});
DB.scores=[{id:"stu1",name:"Priya",grade:"11",log:{"g2026-11-13":{p:10,d:"2026-11-13"}}}];
DB.mine=[{id:"stu1",push:{token:"tok1"}},{id:"stu2",push:{token:"dead"}},{id:"stu3"}];
WRITES=[];var pm=morningPush();
check("push to Priya with points and streak", PUSHES[0]&&PUSHES[0].token==="tok1"&&PUSHES[0].data.title==="Today's game: Saturday special"&&/\+10 points from yesterday/.test(PUSHES[0].data.body)&&/6-day streak/.test(PUSHES[0].data.body), PUSHES[0]&&JSON.stringify(PUSHES[0].data));
check("expired token removed", WRITES.length===1&&WRITES[0].update.name.indexOf("mine/stu2")>0&&WRITES[0].updateMask.fieldPaths[0]==="push", pm);
check("no push without a token", PUSHES.length===2);
// --- weekly digest
var MAILS=[];MailApp={sendEmail:function(o){MAILS.push(o)},getRemainingDailyQuota:function(){return 100}};
DB.mine=[{id:"stu1",digest:true},{id:"stu2",digest:true,digestSent:"2026-11-16"},{id:"stu3",digest:false}];DB.private=[{id:"stu1",email:"priya@example.org"},{id:"stu2",email:"m@example.org"}];
DB.events=[{id:"e1",title:"Winter formal",date:"2026-11-20",location:"Gym"},{id:"e2",title:"Council meeting",date:"2026-11-18",type:"meeting"}];DB.opps=[{id:"o1",title:"Science fair",deadline:"2026-11-19"}];
call_=function(){return{fields:enc_({lastWeek:{rank:[{name:"Dani"},{name:"Priya"}]}}).mapValue.fields}};
Utilities.formatDate=function(d,tz,f){return f==="H"?"17":f==="u"?"7":f==="yyyy-MM-dd"?"2026-11-15":"Sun, Nov 15"};WRITES=[];var dg=weeklyDigest();
check("digest to opted-in students not yet sent this week", MAILS.length===1&&MAILS[0].to==="priya@example.org", dg);
check("digest content: events (no meetings), deadlines, winners", /Winter formal/.test(MAILS[0].htmlBody)&&!/Council meeting/.test(MAILS[0].htmlBody)&&/Science fair/.test(MAILS[0].htmlBody)&&/1\. Dani, 2\. Priya/.test(MAILS[0].htmlBody));
check("marked as sent for the week of Nov 16", WRITES[0]&&decFields_(WRITES[0].update.fields).digestSent==="2026-11-16");
// --- student list from the Google Sheet
var SHEET=[["Email","Name","Grade","Birthday","StuCo","Club leader"],["Ava@X.org","Ava","10","3/14","yes",""],["ben@x.org","Ben","11","","Treasurer",""],["cam@x.org","Cam","9","","",""],["eli@x.org","Eli","12","","no","Robotics; Chess"]],STAMP=1,PROPS={};
SpreadsheetApp={openByUrl:function(){return{getId:function(){return"id"},getSheets:function(){return[{getDataRange:function(){return{getDisplayValues:function(){return SHEET}}}}]}}}};
DriveApp={getFileById:function(){return{getLastUpdated:function(){return new Date(STAMP)}}}};
PropertiesService={getScriptProperties:function(){return{getProperty:function(k){return PROPS[k]||null},setProperty:function(k,v){PROPS[k]=v}}}};
ROSTER_SHEET="https://docs.google.com/spreadsheets/d/x";
DB.roster=[{id:"ben@x.org",name:"Ben",grade:"11",council:false,clubs:[],invitedAt:"t0",uid:"u-ben"},{id:"old@x.org",name:"Old",grade:"12",council:false,clubs:[]},{id:"nico@x.org",name:"",grade:"",council:true,clubs:[],extra:true}];
DB.birthdays=[{id:"rold",name:"Old",month:1,day:1,show:true,roster:true},{id:"stu9",name:"Self added",month:2,day:2,show:true}];
call_=function(m,u){return /admin\/access/.test(u)?{fields:enc_({emails:["nico@x.org","cam@x.org"]}).mapValue.fields}:null};
WRITES=[];var rr=syncRoster();
var RW={};WRITES.forEach(function(w){if(w["delete"])RW["DEL "+w["delete"].split("/documents/")[1]]=1;else RW[w.update.name.split("/documents/")[1]]=decFields_(w.update.fields)});
check("sheet rows read with header detection, emails lowercased", !!RW["roster/ava@x.org"]&&RW["roster/ava@x.org"].council===true&&RW["roster/ava@x.org"].bm===3, rr);
check("a title in StuCo makes council with that position", RW["roster/ben@x.org"].council===true&&RW["roster/ben@x.org"].role==="Treasurer");
check("invite and sign-in info kept", RW["roster/ben@x.org"].invitedAt==="t0"&&RW["roster/ben@x.org"].uid==="u-ben");
check("blank StuCo but on the approved list stays council", RW["roster/cam@x.org"].council===true);
check("no means not council; clubs read", RW["roster/eli@x.org"].council===false&&RW["roster/eli@x.org"].clubs.join(",")==="robotics,chess");
check("people no longer in the sheet removed", RW["DEL roster/old@x.org"]===1);
check("approved emails kept even if not in the sheet", !RW["DEL roster/nico@x.org"]);
check("sheet birthdays written, old list birthdays removed, self-added kept", !!RW["birthdays/"+rosterBid_("ava@x.org")]&&RW["DEL birthdays/rold"]===1&&!RW["DEL birthdays/stu9"]);
check("birthday id matches the site's", rosterBid_("ava@x.org")==="r"+(function(e){var h=0;for(var i=0;i<e.length;i++)h=(h*31+e.charCodeAt(i))>>>0;return h.toString(36)})("ava@x.org"));
check("sync status saved for the Members page", RW["config/access"]&&RW["config/access"].rosterSync.rows===4&&RW["config/access"].rosterSync.held===false);
WRITES=[];var r2=syncRoster();check("skips when the sheet hasn't changed", r2==="sheet unchanged"&&WRITES.length===0, r2);
// guard: a sheet that suddenly shrank removes nobody
DB.roster=[];for(var i=0;i<40;i++)DB.roster.push({id:"s"+i+"@x.org",name:"S"+i,grade:"9",council:false,clubs:[]});
SHEET=[["Email","Name"],["s1@x.org","S1"]];STAMP=2;WRITES=[];var r3=syncRoster();
check("shrunken sheet: no removals, flagged", !WRITES.some(function(w){return w["delete"]})&&/held back/.test(r3), r3);
SHEET=[["Email","Name"]];STAMP=3;var threw=false;try{syncRoster()}catch(e){threw=/no rows/.test(e.message)}
check("empty sheet: stops with an error, writes nothing", threw);
out.join("\n");
