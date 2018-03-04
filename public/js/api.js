var $alert = $("#alert");
var $modal = $(".modal");

function generateHandler(url) {
    return StripeCheckout.configure({
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
    
            $.post(url, data, function(data) {
                if (data === "OK") {
                    window.location = "/api";
                    location.reload();
                }
                else {
                    console.log(data);
                    $alert.text(data);
                    $alert.show();
                }
            });
        }
    });
}

const createHandler = generateHandler("/api/create");
const updateHandler = generateHandler("/api/update");

function showModal() {
    $modal.show();
}

function openStripe() {
    $modal.hide();
    // Open Checkout with further options
    createHandler.open({
        name: 'API Key',
        description: "Get access to more monthly API calls"
    });
};

function openUpdate() {
    updateHandler.open({
        name: 'API Key',
        description: "Get access to more monthly API calls"
    });
}

// Close Checkout on page navigation
$(window).on('popstate', function() {
    handler.close();
});