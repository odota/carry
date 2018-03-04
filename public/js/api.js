console.log(stripe_public);

var handler = StripeCheckout.configure({
    key: stripe_public,
    image: '/public/images/logo.png',
    locale: 'auto',
    zipCode: true,
    billingAddress: true,
    token: function(token, args) {
        var data = {
            token: token,
            address: args
        };

        $.post("/stripe_checkout", data, function(data) {
            if (data === "OK") window.location = "/thanks";
            else {
                $alert.text(data);
                $alert.show();
            }
        });
    }
});

function showModal() {
    $(".modal").css("display", "block");    
}

function openStripe() {
    // Open Checkout with further options
    console.log("test");
    handler.open({
        name: 'API Key',
        description: "Get access to more monthly API calls",
        bitcoin: true,
        alipay: true
    });
};

// Close Checkout on page navigation
$(window).on('popstate', function() {
    handler.close();
});