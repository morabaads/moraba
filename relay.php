<?php
/**
 * Meeting media relay without loading WordPress (fast path). See includes/class-mp-relay.php.
 */
define( 'MP_RELAY', true );
error_reporting( 0 );
require __DIR__ . '/includes/class-mp-relay.php';
MP_Relay::serve_standalone();
