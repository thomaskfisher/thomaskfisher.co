<?php

/*
// grab recaptcha library
require_once "recaptchalib.php";
// your secret key
$secret = "6LfrCSEUAAAAAPDNM0bdeVYIoqte7B824N7IRRdQ";
// empty response
$response = null;
// check secret key
$reCaptcha = new ReCaptcha($secret);
// if submitted check response
if ($_POST["g-recaptcha-response"]) {
    $response = $reCaptcha->verifyResponse(
        $_SERVER["REMOTE_ADDR"],
        $_POST["g-recaptcha-response"]
    );
}*/




if(!isset($_POST['submit']))
{
	//This page should not be accessed directly. Need to submit the form.
	echo "error; you need to submit the form!";
}
$first_name = $_POST['first_name'];
$last_name = $_POST['last_name'];
$visitor_email = $_POST['email'];
$message = $_POST['message'];

//Validate first
if(empty($first_name)||empty($last_name)||empty($visitor_email))
{
    echo "Name and email are mandatory!";
    exit;
}

if(IsInjected($visitor_email))
{
    echo "Bad email value!";
    exit;
}

$email_from = 'tkfisher7@gmail.com';//<== update the email address
$email_subject = "WEBSITE CONTACT";
$email_body = "       FROM: $first_name $last_name ($visitor_email)\n".
    "MESSAGE: $message";

$to = "tkfisher7@gmail.com";//<== update the email address
$headers = "From: $email_from \r\n";
$headers .= "Reply-To: $visitor_email \r\n";
//Send the email!
mail($to,$email_subject,$email_body,$headers);


//send a confimation email to the sender
$to2 = $visitor_email;
$email_subject2 = "Email Confirmation";
$email_body2 = "Thank you for your message. I will get back to you as soon as possible.\n".
	"Sincerly,\n".
	"Thomas Fisher";
$headers2 = "";
$headers2 .= "";
mail($to2,$email_subject2,$email_body2,$headers2);


//done. redirect to thank-you page.
//header('Location: thank-you.html');
header('Location: index.html');

// Function to validate against any email injection attempts
function IsInjected($str)
{
  $injections = array('(\n+)',
              '(\r+)',
              '(\t+)',
              '(%0A+)',
              '(%0D+)',
              '(%08+)',
              '(%09+)'
              );
  $inject = join('|', $injections);
  $inject = "/$inject/i";
  if(preg_match($inject,$str))
    {
    return true;
  }
  else
    {
    return false;
  }
}
?>