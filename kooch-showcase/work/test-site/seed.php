<?php
require_once ABSPATH.'wp-admin/includes/media.php';require_once ABSPATH.'wp-admin/includes/file.php';require_once ABSPATH.'wp-admin/includes/image.php';
function img($f){$tmp=wp_tempnam($f);copy("/tmp/pimg/$f.jpg",$tmp);$id=media_handle_sideload(['name'=>"$f.jpg",'tmp_name'=>$tmp],0);return is_wp_error($id)?0:$id;}
$cat=function($n){$t=term_exists($n,'product_cat');if(!$t)$t=wp_insert_term($n,'product_cat');return (int)$t['term_id'];};
$mob=$cat('موبایل');$acc=$cat('لوازم جانبی');$lap=$cat('لپ‌تاپ و تبلت');
$brand=function($n){$a=wc_create_attribute(['name'=>'برند','slug'=>'brand']);};
$items=[
['گوشی موبایل سامسونگ Galaxy A55 ظرفیت ۲۵۶ گیگابایت',189900000,169900000,'phone',$mob,['حافظه داخلی'=>'۲۵۶ گیگابایت','رم'=>'۸ گیگابایت','اندازه صفحه'=>'۶٫۶ اینچ']],
['هدفون بی‌سیم سونی مدل WH-CH720N',64900000,0,'headphone',$acc,['نوع اتصال'=>'بلوتوث ۵٫۲','عمر باتری'=>'۳۵ ساعت','نویز کنسلینگ'=>'دارد']],
['ساعت هوشمند شیائومی Redmi Watch 4',42500000,38900000,'watch',$acc,['اندازه صفحه'=>'۱٫۹۷ اینچ','مقاومت در برابر آب'=>'۵ اتمسفر']],
['لپ‌تاپ ۱۵ اینچی لنوو IdeaPad Slim 3',459000000,0,'laptop',$lap,['پردازنده'=>'Core i5-12450H','رم'=>'۱۶ گیگابایت','حافظه'=>'۵۱۲ گیگابایت SSD']],
['اسپیکر بلوتوثی جی‌بی‌ال Flip 6',78900000,0,'speaker',$acc,['توان'=>'۳۰ وات','مقاومت در برابر آب'=>'IP67']],
['تبلت سامسونگ Galaxy Tab A9 Plus',132000000,124500000,'tablet',$lap,['اندازه صفحه'=>'۱۱ اینچ','حافظه داخلی'=>'۱۲۸ گیگابایت']],
];
$n=0;foreach($items as [$name,$reg,$sale,$im,$c,$specs]){
 $p=new WC_Product_Simple();$p->set_name($name);$p->set_status('publish');$p->set_regular_price($reg);if($sale)$p->set_sale_price($sale);
 $p->set_short_description('ارسال سریع، گارانتی ۱۸ ماهه و ضمانت اصالت کالا.');
 $p->set_description('<p>'.$name.' با کیفیت ساخت بالا و مشخصات به‌روز، انتخابی مطمئن برای استفاده‌ی روزمره است.</p>');
 $p->set_category_ids([$c]);$p->set_manage_stock(true);$p->set_stock_quantity(rand(3,40));$p->set_sku('SKU-'.(1000+$n));
 $attrs=[];foreach($specs as $k=>$v){$a=new WC_Product_Attribute();$a->set_name($k);$a->set_options([$v]);$a->set_visible(true);$attrs[]=$a;}$p->set_attributes($attrs);
 $id=img($im);if($id){$p->set_image_id($id);$g=img($im);$p->set_gallery_image_ids($g?[$g]:[]);}
 $p->save();$n++;}
// variable product
$v=new WC_Product_Variable();$v->set_name('گوشی موبایل شیائومی Redmi Note 13 ظرفیت ۲۵۶ گیگابایت');$v->set_status('publish');$v->set_category_ids([$mob]);
$a=new WC_Product_Attribute();$a->set_name('رنگ');$a->set_options(['مشکی','آبی','سبز']);$a->set_visible(true);$a->set_variation(true);$v->set_attributes([$a]);
$id=img('phone');if($id)$v->set_image_id($id);$v->set_short_description('در سه رنگ با قیمت جداگانه.');$pid=$v->save();
foreach(['مشکی'=>119900000,'آبی'=>121500000,'سبز'=>118900000] as $col=>$pr){$x=new WC_Product_Variation();$x->set_parent_id($pid);$x->set_attributes(['رنگ'=>$col]);$x->set_regular_price($pr);$x->set_manage_stock(true);$x->set_stock_quantity(rand(2,12));$x->save();}
WC_Product_Variable::sync($pid);
echo "seeded ".($n+1)."\n";
