<?php
define('ABSPATH','/tmp/'); define('HOUR_IN_SECONDS',3600);
class WP_Error { public $m; function __construct($c,$m,$d=[]){$this->m=$m;} function get_error_message(){return $this->m;} }
function is_wp_error($x){return $x instanceof WP_Error;}
class WP_REST_Request implements ArrayAccess { public $p=[],$method,$route; function __construct($m='GET',$r=''){$this->method=$m;$this->route=$r;} function set_param($k,$v){$this->p[$k]=$v;} function offsetExists($k):bool{return isset($this->p[$k]);} function offsetGet($k):mixed{return $this->p[$k]??null;} function offsetSet($k,$v):void{$this->p[$k]=$v;} function offsetUnset($k):void{unset($this->p[$k]);} }
class FakeRes { function __construct(public $d){} function is_error(){return is_wp_error($this->d);} function as_error(){return $this->d;} function get_data(){return $this->d;} }
$T=[['id'=>11,'title'=>'طراحی بنر زیوا','date'=>'2026-09-29','time'=>'10:00','status'=>'todo','done'=>false,'priority'=>'medium','user_id'=>1,'project_id'=>3,'items_total'=>0,'items_done'=>0,'locked'=>false,'description'=>''],
 ['id'=>12,'title'=>'Final Review کد','date'=>'2026-09-27','time'=>'','status'=>'todo','done'=>false,'priority'=>'high','user_id'=>1,'project_id'=>0,'items_total'=>0,'items_done'=>0,'locked'=>false,'description'=>''],
 ['id'=>13,'title'=>'تست افزونه کوچ','date'=>'2026-09-26','time'=>'','status'=>'todo','done'=>false,'priority'=>'high','user_id'=>1,'project_id'=>0,'items_total'=>0,'items_done'=>0,'locked'=>false,'description'=>'']];
$GLOBALS['T']=$T;
function rest_do_request($r){ $route=$r->route;
  if(preg_match('#/tasks$#',$route) && $r->method==='GET') return new FakeRes($GLOBALS['T']);
  if(preg_match('#/channels$#',$route) && $r->method==='GET') return new FakeRes([['id'=>5,'type'=>'group','title'=>'تیم فنی','member_ids'=>[1,2],'unread'=>2,'last'=>['author'=>'رضا سعادتی','body'=>'سلام']],['id'=>6,'type'=>'project','title'=>'سایت زیوا','member_ids'=>[],'unread'=>0,'last'=>null],['id'=>7,'type'=>'direct','title'=>'رضا سعادتی','other'=>2,'unread'=>0,'last'=>null]]);
  if(preg_match('#/projects$#',$route)) return new FakeRes(['projects'=>[['id'=>3,'name'=>'سایت زیوا','status'=>'doing','start'=>'2026-09-01','end'=>'2026-10-30','members'=>[1,2],'tasks'=>['todo'=>4,'doing'=>1,'done'=>5],'sections'=>[],'milestones'=>[]]]]);
  if(preg_match('#/meetings$#',$route)) return new FakeRes([]);
  return new FakeRes([]); }
$GLOBALS['tr']=[];
function get_transient($k){return $GLOBALS['tr'][$k]??false;} function set_transient($k,$v){$GLOBALS['tr'][$k]=$v;}
function get_option($k,$d=false){return $d;} function wp_generate_password($n){return substr(md5(mt_rand()),0,$n);}
function untrailingslashit($s){return rtrim($s,'/');}
function get_current_user_id(){return 1;}
function current_time($f){return ['H:i'=>'09:30','H'=>'09','Y-m-d'=>'2026-09-29'][$f];}
function get_userdata($id){ $n=[1=>'علی چهارمحالی',2=>'رضا سعادتی',3=>'مهدی نهانی',4=>'سارا احمدی'][$id]??null; return $n?(object)['display_name'=>$n,'user_login'=>'u'.$id]:false; }
function J_latin($s){return strtr((string)$s,['۰'=>'0','۱'=>'1','۲'=>'2','۳'=>'3','۴'=>'4','۵'=>'5','۶'=>'6','۷'=>'7','۸'=>'8','۹'=>'9']);}
class MP_Util { static function today(){return '2026-09-29';} static function add_days($d,$n){return gmdate('Y-m-d',strtotime("$d $n days UTC"));} static function is_manager($u=0){return $GLOBALS['mgr']??true;} static function is_employee($u=0){return $u!=1;} static function panel_users(){return [1,2,3,4];} static function is_panel_user($u){return in_array($u,[1,2,3,4]);} static function valid_date($v){return (bool)preg_match('/^\d{4}-\d\d-\d\d$/',$v);}
  static function user_payload($id){ $u=get_userdata($id); return ['name'=>$u->display_name,'title'=>'','role'=>'کارمند','status'=>$id==2?'online':'busy']; } }
class MP_Install { static function table($n){return 'wp_mp_'.$n;} }
class MP_Rest { const NS='moraba-panel/v1'; static function get_task($id){foreach($GLOBALS['T'] as $t) if($t['id']==$id) return (object)$t; return null;} static function task_payload($t){return (array)$t;} static function ledger_rows($f,$t,$x=[]){return ['income'=>5000000,'expense'=>1200000,'breakdown'=>[['category'=>'هاست','amount'=>800000]]];} }
class MP_Digest { static function morning_for($u,$d){return ['title'=>'صبح بخیر! امروز ۳ تسک','detail'=>''];} static function weekly($d){return ['totals'=>['done'=>9,'overdue'=>2,'hours'=>40],'people'=>[],'money'=>['income'=>1,'expense'=>2]];} }
$GLOBALS['wpdb']=new class { function get_results($q){ return [(object)['id'=>3,'name'=>'سایت زیوا'],(object)['id'=>4,'name'=>'افزونه انتقال محصولات کوچ'],(object)['id'=>5,'name'=>'سایت جورابیان (المنتوری‌سازی)']]; } function get_var($q){return '';} function prepare($q,...$a){return $q;} };
require __DIR__ . '/../includes/class-mp-jalali.php';
require __DIR__ . '/../includes/class-mp-ai.php';
require __DIR__ . '/../includes/class-mp-brain.php';
function ask($text,$mgr=true){ $GLOBALS['mgr']=$mgr; $r=new WP_REST_Request('POST'); $r->set_param('text',$text); return MP_Brain::handle($r); }
// [phrase, expected: tool/"reply", checks...]
$cases=[
 ['یک گروه بین من و مهدی بساز', 'create_group', fn($a)=>$a['members']==['مهدی نهانی'] && $a['title']=='علی و مهدی'],
 ['یه گروه به اسم طراحی با رضا و مهدی درست کن', 'create_group', fn($a)=>$a['title']=='طراحی' && $a['members']==['رضا سعادتی','مهدی نهانی']],
 ['گروه برای همه بچه ها بساز', 'create_group', fn($a)=>count($a['members'])==3],
 ['سارا رو به گروه تیم فنی اضافه کن', 'add_group_members', fn($a)=>$a['group']=='تیم فنی' && $a['members']==['سارا احمدی']],
 ['به رضا بگو فایل نهایی رو فرستادم', 'send_message', fn($a)=>$a['to']=='رضا سعادتی' && $a['text']=='فایل نهایی رو فرستادم'],
 ['پیام بده به مهدی که جلسه ساعت ۵ کنسله', 'send_message', fn($a)=>$a['to']=='مهدی نهانی' && str_contains($a['text'],'جلسه ساعت ۵ کنسله')],
 ['تو گروه تیم فنی بنویس امروز زودتر میرم', 'send_message', fn($a)=>$a['to']=='تیم فنی' && $a['text']=='امروز زودتر میرم'],
 ['برای رضا و مهدی پنجشنبه ساعت ۱۰ تسک تست نهایی بذار', 'create_task', fn($a)=>$a['assignees']==['رضا سعادتی','مهدی نهانی'] && $a['date']=='2026-10-01' && $a['time']=='10:00' && $a['title']=='تست نهایی'],
 ['تسک طراحی لوگو فوری فردا ساعت ۱۱ برای پروژه زیوا', 'create_task', fn($a)=>$a['title']=='طراحی لوگو' && $a['date']=='2026-09-30' && $a['time']=='11:00' && $a['project']=='سایت زیوا' && $a['priority']=='high'],
 ['برای خودم تسک خرید هاست بذار', 'create_task', fn($a)=>$a['title']=='خرید هاست'],
 ['تسک بنر زیوا انجام شد', 'update_task', fn($a)=>$a['task_id']==11 && $a['status']=='done'],
 ['تسک های عقب افتاده رو ببر برای فردا', 'update_task', fn($a)=>$a['date']=='2026-09-30'],
 ['امروز چه کارهایی دارم', 'reply', fn($r)=>str_contains($r,'طراحی بنر زیوا')],
 ['عقب افتاده هام چیه', 'reply', fn($r)=>str_contains($r,'Final Review')],
 ['یادم بنداز ۵ عصر زنگ بزنم به مشتری', 'create_reminder', fn($a)=>$a['time']=='17:00' && $a['title']=='زنگ بزنم به مشتری'],
 ['هر روز ساعت ۹ صبح یادآوری کن گزارش بفرستم', 'create_reminder', fn($a)=>$a['repeat']=='daily' && $a['time']=='09:00'],
 ['فردا ساعت ده و نیم با علی و مهدی درباره سایت زیوا جلسه بذار', 'create_meeting', fn($a)=>$a['time']=='10:30' && $a['date']=='2026-09-30' && $a['people']==['مهدی نهانی']],
 ['ورودم رو ثبت کن', 'clock', fn($a)=>$a['action']=='in'],
 ['خروج', 'clock', fn($a)=>$a['action']=='out'],
 ['پنجشنبه مرخصی می خوام', 'request_leave', fn($a)=>$a['kind']=='daily' && $a['start']=='2026-10-01'],
 ['فردا از ۱۰ تا ۱۲ مرخصی ساعتی', 'request_leave', fn($a)=>$a['kind']=='hourly' && $a['from_time']=='10:00' && $a['to_time']=='12:00'],
 ['۱۳۰ تومن خرج افزونه', 'add_ledger', fn($a)=>$a['amount']==130000 && $a['type']=='expense'],
 ['دو میلیون و پانصد از زیوا گرفتم', 'add_ledger', fn($a)=>$a['amount']==2500000 && $a['type']=='income' && $a['project']=='سایت زیوا'],
 ['این ماه چقدر خرج کردیم', 'reply', fn($r)=>str_contains($r,'خرج')],
 ['پروژه جدید به اسم نارنج با رضا بساز', 'create_project', fn($a)=>$a['name']=='نارنج' && $a['members']==['رضا سعادتی']],
 ['مهدی رو به پروژه زیوا اضافه کن', 'add_project_members', fn($a)=>$a['project']=='سایت زیوا'],
 ['پروژه زیوا چطوره', 'reply', fn($r)=>str_contains($r,'۵۰٪')],
 ['فاکتور ۵ میلیونی برای زیوا بابت طراحی سایت بزن', 'create_invoice', fn($a)=>$a['items'][0]['price']==5000000 && $a['kind']=='invoice'],
 ['گزارش روزانه: صفحه اصلی زیوا تموم شد ۸۰ درصد فردا صفحات داخلی', 'save_daily_report', fn($a)=>$a['progress']==80 && str_contains($a['tomorrow'],'صفحات داخلی')],
 ['کی آنلاینه', 'reply', fn($r)=>str_contains($r,'رضا')],
 ['رضا داره چیکار میکنه', 'reply', fn($r)=>str_contains($r,'رضا سعادتی')],
 ['پیام جدید دارم', 'reply', fn($r)=>str_contains($r,'تیم فنی')],
 ['برو به تقویم', 'open_page', fn($a)=>$a['page']=='calendar'],
 ['سلام', 'reply', fn($r)=>str_contains($r,'بخیر')],
 ['به رضا بگو فایل رو فرستادم و برای مهدی فردا تسک بررسی بذار', 'multi', fn($acts)=>count($acts)==2],
];
$pass=0;$fail=0;
foreach($cases as [$q,$exp,$chk]){
  $GLOBALS['tr']=[];
  $out=ask($q);
  $acts=array_map(fn($p)=>$GLOBALS['tr']['mp_brain_1']['pending'][$p['id']]??null,$out['pending']);
  $ok=false; $got='';
  if($exp==='reply'){ $ok=$chk($out['reply']); $got=$out['reply']; }
  elseif($exp==='multi'){ $ok=$chk($acts); $got=json_encode(array_map(fn($a)=>$a['tool'],$acts),JSON_UNESCAPED_UNICODE); }
  elseif($exp==='open_page'||$exp==='clock'&&false){ }
  if($exp!=='reply'&&$exp!=='multi'){
    $a=null; foreach($acts as $x) if($x&&$x['tool']===$exp){$a=$x['args'];break;}
    if(!$a && $exp==='open_page'){ $ok=!empty($out['client']) && $chk($out['client'][0]); $got=json_encode($out['client'],JSON_UNESCAPED_UNICODE);} 
    else { $ok=$a && $chk($a); $got=json_encode($acts,JSON_UNESCAPED_UNICODE).' | '.$out['reply']; }
  }
  if($ok) $pass++; else { $fail++; echo "✗ $q\n   → $got\n"; }
}
echo "\n$pass passed, $fail failed\n";
