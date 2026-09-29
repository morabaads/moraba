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
 ['یک گروه بین من و مهدی بساز', 'open_page', fn($a)=>$a['page']=='messages', false],
 ['برای رضا تسک طراحی بذار', 'reply', fn($r)=>str_contains($r,'ناظر'), false],
 ['تسک های رضا', 'reply', fn($r)=>str_contains($r,'ناظر'), false],
 ['ساعت چهار و ربع بعد از ظهر یادم بنداز داروهامو بخورم', 'create_reminder', fn($a)=>$a['time']=='16:15'],
 ['۴۵ دقیقه دیگه یادآوری کن ایمیل رو چک کنم', 'create_reminder', fn($a)=>$a['time']=='10:15'],
 ['فردا ظهر با رضا جلسه', 'create_meeting', fn($a)=>$a['time']=='12:00' && $a['people']==['رضا سعادتی']],
 ['۱۰ مهر ساعت ۹ صبح تسک ارسال فاکتور زیوا بذار', 'create_task', fn($a)=>$a['date']=='2026-10-02' && $a['time']=='09:00'],
 ['آخر هفته تسک بکاپ گرفتن بذار', 'create_task', fn($a)=>$a['date']=='2026-10-01' && $a['title']=='بکاپ گرفتن'],
 ['هر هفته تسک گزارش مالی بذار برای خودم', 'create_task', fn($a)=>$a['recurrence']=='weekly'],
 ['دویست و پنجاه هزار تومن خرج اینترنت', 'add_ledger', fn($a)=>$a['amount']==250000],
 ['سه میلیون دادم به طراح', 'add_ledger', fn($a)=>$a['amount']==3000000 && $a['type']=='expense'],
 ['به همه بگو فردا تعطیله', 'multi', fn($acts)=>count($acts)==3],
 ['برای همه تسک پر کردن تایم شیت جمعه بذار', 'create_task', fn($a)=>count($a['assignees'])==3],
 ['مهدی و سارا رو به گروه تیم فنی اضافه کن', 'add_group_members', fn($a)=>$a['members']==['مهدی نهانی','سارا احمدی']],
 ['پروژه جورابیان به کجا رسید', 'reply', fn($r)=>mb_strlen($r)>3],
 ['خلاصه امروزم رو بگو', 'reply', fn($r)=>str_contains($r,'تسک')],
];
$pass=0;$fail=0;
foreach($cases as $c){ [$q,$exp,$chk]=$c; $mg=$c[3]??true;
  $GLOBALS['tr']=[];
  $out=ask($q,$mg);
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
