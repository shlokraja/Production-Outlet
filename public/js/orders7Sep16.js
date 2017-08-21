function populateOrders(time)
{
	var jqxhr = $.getJSON(HQ_URL + '/outlet/show_orders/' + OUTLET_ID + '?time=' + time)
	.done(function (data)
	{
		console.log('Received order data');
		var tableDiv = $("#orders table tbody");
		$(tableDiv).empty();
		for (var i = 0; i < data.length; i++)
		{
			var date_obj = new Date(data[i].time);
			var payment_mode = data[i].method;
			var dispense_statuses = (data[i].dispense_status.substr(1, data[i].dispense_status.length - 2)).split(',');
			if (payment_mode == 'cash')
			{
				var icon_url = "img/icons/Cash.png";
			} else
			{
				var icon_url = "img/icons/Card.png";
			}

			var dispense_status = computeDispenseStatus(dispense_statuses);
			if (dispense_status == 'pending' ||
			  dispense_status == 'dispensing' ||
			  dispense_status == 'timeout')
			{
				var status_icon = 'img/icons/Pending.png';
			} else
			{
				var status_icon = 'img/icons/Delivered.png';
			}
			var mobile_num = data[i].mobile_num;
			$(tableDiv).append('<tr onclick="openOrderItems(' + data[i].id + ',' + mobile_num + ',this)";><td><img class="icon" src="img/icons/Right Arrow.png">' + data[i].id + '</td><td>' + data[i].bill_nos + '</td><td><img class="icon" src="' + status_icon + '">' + dispense_status + '</td><td><img class="icon" src="' + icon_url + '">' + data[i].method + '</td><td>' + date_obj.toLocaleTimeString() + '</td><td><img class="icon rupee-img" src="img/icons/Rupee.png">' + data[i].amount_due + '</td></tr>');
		}

	})
	.fail(function (jqxhr, textStatus, error)
	{
		var err_msg = textStatus + ", " + jqxhr.responseText;
		console.error("Request Failed: " + err_msg);
	});
}

function pad(num, size)
{
	var s = String(num);
	while (s.length < (size || 2)) { s = "0" + s; }
	return s;
}

function checkIfAlreadyRefunded(sourceBarcode, refunded_current_cycle)
{
	var goodItems = 0;
	var badItems = 0;
	$("#orders .bill_item_checkbox").each(function (index)
	{
		var barcode = $(this).attr("data-barcode");
		var td_items = $(this).parents("tr").first().children();
		var item_id = parseInt((td_items[1]).innerText);
		var price = parseInt((td_items[3]).innerText);
		if (barcode == '')
		{
			// This is a snack item, need to construct an artificial barcode
			barcode = 'xxxxxxxx' + pad(item_id.toString(36).toUpperCase(), 4) + 'xxxxxxxxxxxx';
		}

		if (barcode == sourceBarcode)
		{
			if (price > 0)
			{
				goodItems++;
			} else
			{
				badItems++;
			}
		}
	});
	if ((badItems + refunded_current_cycle) >= goodItems)
	{
		return true;
	} else
	{
		return false;
	}
}

$("#orders").on("click", "#refund", function (event)
{
	console.log("Refund button is clicked");
	var total_price = 0;
	var item_details = {};
	var refunded_current_cycle = 0;
	$("#orders .bill_item_checkbox:checked").each(function (index)
	{
		var barcode = $(this).attr("data-barcode");
		var td_items = $(this).parents("tr").first().children();
		var item_id = parseInt((td_items[1]).innerText);
		var price = parseInt((td_items[3]).innerText);
		if (barcode.startsWith("xxxxx") || price < 0)
		{
			return;
		}
		if (barcode == '')
		{
			// This is a snack item, need to construct an artificial barcode
			barcode = 'xxxxxxxx' + pad(item_id.toString(36).toUpperCase(), 4) + 'xxxxxxxxxxxx';
		}

		if (checkIfAlreadyRefunded(barcode, refunded_current_cycle)) {
			total_price=0;
			return false;
		}
		refunded_current_cycle++;

		total_price += price;

		// preparing the item_details
		if (barcode in item_details)
		{
			item_details[barcode]++;
		} else
		{
			item_details[barcode] = 1;
		}
	});

	if (total_price == 0)
	{
		return false;
	}

	$("#orders .error_msg").remove();
	$("#confirm-refund-dialog .refund_amount").text(total_price);
	$("#confirm-refund-dialog").modal('show');
});

$("#orders").on("click", "#replace", function ()
{
	console.log("Replace button is clicked");
	var dropdown_string = '<select class="form-control">';
	// Creating the item select drop down from the stock count
	for (var key in stock_count)
	{
		var displayable_count = getStockItemCount(stock_count[key]["item_details"]) - stock_count[key]["locked_count"];
		// If the no. is greater than 0, only then display
		if (displayable_count > 0)
		{
			if (!price_data.hasOwnProperty(key))
			{
				continue;
			}
			dropdown_string += '<option value="' + key + '">' + key + ' - ' + price_data[key]["name"] + '</option>';
		}
	}
	dropdown_string += '</select>'
	$("#replace-tab-headers").empty();
	$("#replace-tab-content").empty();

	var price_difference = 0;
	var outside_items = 0;
	var total_items = 0;
	var replace_current_cycle = 0;
	$("#orders .bill_item_checkbox:checked").each(function (index)
	{
		var td_items = $(this).parents("tr").first().children();
		// No replace for snacks items
		if ($(this).attr("data-barcode") == '' || $(this).attr("data-barcode").startsWith("xxxxx"))
		{
			outside_items++;
			return false;
		}
		var item_id = parseInt((td_items[1]).innerText);
		var item_name = (td_items[2]).innerText;
		var price = parseInt((td_items[3]).innerText);

		if (checkIfAlreadyRefunded($(this).attr("data-barcode"),replace_current_cycle) || price < 0)
		{
			return false;
		}
		total_items++;
		replace_current_cycle++;
		// This is required to make the first tab active
		if (index == 0)
		{
			var header_active = "active";
			var content_active = "active in";
		} else
		{
			var active = "";
			var content_active = "";
		}

		$("#replace-tab-headers").append('<li class="' + active + '"><a href="#id' + item_id + '" data-toggle="tab">Item ID: ' + item_id + '</a></li>');
		$("#replace-tab-content").append('<div class="tab-pane fade ' + content_active + '" id="id' + item_id + '" data-price="' + price + '">\
	  <div>Select Replacement</div>\
	  '+ dropdown_string + '\
	  </div>');
		$("#replace-tab-content #id" + item_id + " select").val(item_id);
		$("#replace-tab-content #id" + item_id + " select").attr("data-old-val", item_id);
		// locking the items in the dispenser
		var jqxhr = $.post(OUTLET_URL + '/order_app/lock_item/' + item_id,
		  { "direction": "increase", "delta_count": 1 })
		  .done(function ()
		  {
		  })
		  .fail(function ()
		  {
			  console.error("Error occured while removing the lock for item- " + item_id);
		  });
		// calculating the price difference
		price_difference += (price_data[item_id]["mrp"] - price);
	});
	$("#replace-dialog .modal-header .cash_difference_amount").text(price_difference);

	// Checking if all items are snacks items or not
	if ($("#orders .bill_item_checkbox:checked").length == outside_items ||
	  !total_items)
	{
		return;
	}
	// Reinitializing the material library because new items were added
	$.material.init();
	$("#replace-dialog").modal('show');
});

$("#orders").on("click", "#generate_bill", function ()
{
	// get order id
	// get mobile num
	// call to generate duplicate bill
	var order_id = $(this).parent().parent().find("#temp_table").attr("data-order-id");
	var mobile_num = $(this).parent().parent().find("#temp_table").attr("data-mobile_num");
	$.ajax({
		type: 'POST',
		url: OUTLET_URL + '/order_app/generate_duplicate_bill/' + order_id,
		data: JSON.stringify({ "mobile_num": mobile_num }),
		success: function (data)
		{
			console.log(data);
			$("#refund_buttons").append('<div>' + data + '</div>');
		},
		error: function (jqxhr, textStatus, error)
		{
			var err_msg = textStatus + ", " + jqxhr.responseText;
			console.error("Refund items failed: " + err_msg);
		},
		contentType: "application/json",
		dataType: "text"
	});
});

$("#replace-dialog").on("change", "#replace-tab-content select", function ()
{
	// Recomputing the cash difference because the drop down items have changed
	var price_difference = 0;
	// unlock the older item
	var item_id = $(this).attr("data-old-val");
	var new_item_id = $(this).val();
	var scope = this;
	var jqxhr = $.post(OUTLET_URL + '/order_app/lock_item/' + item_id,
	  { "direction": "decrease", "delta_count": 1 })
	  .done(function ()
	  {
		  // lock the new item
		  $.post(OUTLET_URL + '/order_app/lock_item/' + new_item_id,
		  { "direction": "increase", "delta_count": 1 })
		  .done(function ()
		  {
			  // place the new item in the attribute
			  $(scope).attr("data-old-val", new_item_id);
		  })
		  .fail(function ()
		  {
			  console.error("Error occured while creating the lock for item- " + new_item_id);
		  });
	  })
	  .fail(function ()
	  {
		  console.error("Error occured while removing the lock for item- " + item_id);
	  });

	$("#replace-tab-content").children().each(function ()
	{
		var item_id = parseInt($(this).find("select").val());
		var price = $(this).attr("data-price");
		price_difference += price_data[item_id]["mrp"] - price;
	});
	if (price_difference >= 0)
	{
		$("#replace-dialog .modal-header .cash_diff_text").text("Please collect ");
	} else
	{
		$("#replace-dialog .modal-header .cash_diff_text").text("Please refund ");
	}
	$("#replace-dialog .modal-header .cash_difference_amount").text(Math.abs(price_difference));
});

$("#orders").on("change", "#temp_table thead input[type=checkbox]", function ()
{
	$("#orders .bill_item_checkbox").prop("checked", $(this).is(":checked"));
});

$("#refund_confirm").click(function ()
{
	//var amount = parseInt($("#confirm-refund-dialog .modal-body .refund_amount").text());
});

$("#replace_confirm").click(function ()
{
	var amount = 0;
	var order_id = parseInt($("#temp_table").attr("data-order-id"));
	var mobile_num = parseInt($("#temp_table").attr("data-mobile_num"));
	var item_details = {};
	var replaced_item_details = {};
	var bill_no = -1;

	$("#orders .bill_item_checkbox:checked").each(function (index)
	{
		var barcode = $(this).attr("data-barcode");
		var td_items = $(this).parents("tr").first().children();
		var item_id = parseInt((td_items[1]).innerText);
		bill_no = parseInt((td_items[0]).innerText);
		amount += parseInt((td_items[3]).innerText);
		if (!price_data.hasOwnProperty(item_id))
		{
			return;
		}
		if (price_data[item_id]["stock_quantity"] < 1)
		{
			$("#refund-dialog .modal-body").append("Only " + price_data[item_id]["stock_quantity"] + "items left for item id " + item_id);
		}
		if (barcode in item_details)
		{
			item_details[barcode]++;
		} else
		{
			item_details[barcode] = 1;
		}
		var replaced_item_id = parseInt($("#replace-tab-content #id" + item_id + " select").val());
		if (replaced_item_id in replaced_item_details)
		{
			replaced_item_details[replaced_item_id]++;
		} else
		{
			replaced_item_details[replaced_item_id] = 1;
		}

		/*if (showItemExpiryPopup(item_id) == true) {
		  // make the call to LC to expire that entire batch
		  console.log("expiring all items of id - "+ item_id);
		  $.ajax({
			type: 'POST',
			url: OUTLET_URL + '/outlet_app/expire_item_batch/' + item_id,
			success: function(data) {
			  console.log(data);
			 },
			error: function(jqxhr, textStatus, error) {
			  var err_msg = textStatus + ", " + jqxhr.responseText;
			  console.error("Expiring item batch failed: " + err_msg);
			},
			contentType: "application/json",
			dataType: 'text'
		  });
		}*/
	});
	var replaced_amount = 0;

	for (var item_id in replaced_item_details)
	{
		if (!price_data.hasOwnProperty(item_id))
		{
			continue;
		}
		replaced_item_details[item_id] = {
			"count": replaced_item_details[item_id],
			"price": price_data[item_id]["mrp"] * replaced_item_details[item_id],
			"heating_flag": price_data[item_id]["heating_reqd"],
			"name": price_data[item_id]["name"],
			"restaurant_details": price_data[item_id]["restaurant_details"],
			"side_order": price_data[item_id]["side_order"]
		};
		replaced_amount += replaced_item_details[item_id]["price"];
	}

	$.ajax({
		type: 'POST',
		url: OUTLET_URL + '/order_app/fulfill_replacement/' + order_id,
		data: JSON.stringify({
			"amount": amount,
			"replaced_amount": replaced_amount,
			"item_details": item_details,
			"replaced_item_details": replaced_item_details,
			"bill_no": bill_no,
			"mobile_num": mobile_num
		}),
		success: function (data)
		{
			console.log(data);
			var outside_items = 0;
			// Getting the item ids and barcodes and showing the report issue screen
			$("#orders .bill_item_checkbox:checked").each(function (index)
			{
				var barcode = $(this).attr("data-barcode");
				if (barcode == '' || barcode.startsWith("xxxxx"))
				{
					outside_items++;
					return;
				}
				var td_items = $(this).parents("tr").first().children();
				var item_id = parseInt((td_items[1]).innerText);
				var targetDiv = $("#report-issues-dialog .modal-body #food_issue table tbody");
				$(targetDiv).empty();
				// constructing the issue dropdown
				var issuedropDown = '<select class="final_status">';
				ISSUE_TYPES.map(function (item)
				{
					issuedropDown += '<option>' + item + '</option>';
				});
				issuedropDown += '</select>';

				$(targetDiv).append('<tr class="item"><td>' + item_id + '</td><td class="barcode">' + barcode + '</td><td><input class="qty" type="text" value="1"/></td><td>' + issuedropDown + '</td><td><input class="note" type="text" /></td></tr>');
			});

			// Checking if all items are snack items, then returning
			if ($("#orders .bill_item_checkbox:checked").length == outside_items)
			{
				return;
			}
			$("#report-issues-dialog").modal("show");
		},
		error: function (jqxhr, textStatus, error)
		{
			var err_msg = textStatus + ", " + jqxhr.responseText;
			console.error("Replace items failed: " + err_msg);
		},
		contentType: "application/json",
		dataType: "text"
	});
	unlock = false;
	$("#replace-dialog").modal('hide');
});

$("#replace-dialog").on('hidden.bs.modal', function ()
{
	console.log("Modal window was closed");
	if (unlock)
	{
		// Going through each of the items and unlocking them
		$("#replace-tab-content").children().each(function ()
		{
			var item_id = parseInt($(this).find("select").val());
			// Unlocking the item
			var jqxhr = $.post(OUTLET_URL + '/order_app/lock_item/' + item_id,
			  { "direction": "decrease", "delta_count": 1 })
			  .done(function ()
			  {
			  })
			  .fail(function ()
			  {
				  console.error("Error occured while removing the lock for item- " + item_id);
			  });
		});
	}
	unlock = true;
});

$("#refund_cancel").click(function ()
{
	$("#confirm-refund-dialog").modal('hide');
});

$("#refund_ok").click(function ()
{
	$("#confirm-refund-dialog").modal('hide');

	//post the amount to the LC.
	var order_id = parseInt($("#temp_table").attr("data-order-id"));
	var total_price = 0;
	var item_details = {};
	var outside_items = 0;
	var mobile_num = parseInt($("#temp_table").attr("data-mobile_num"));
	$("#orders .bill_item_checkbox:checked").each(function (index)
	{
		var barcode = $(this).attr("data-barcode");
		var td_items = $(this).parents("tr").first().children();
		var item_id = parseInt((td_items[1]).innerText);
		var price = parseInt((td_items[3]).innerText);
		if (barcode == '' || barcode.startsWith("xxxxx"))
		{
			outside_items++;
			return;
		}
		total_price += price;
		// preparing the item_details
		if (barcode in item_details)
		{
			item_details[barcode]++;
		} else
		{
			item_details[barcode] = 1;
		}

		var targetDiv = $("#report-issues-dialog .modal-body #food_issue table tbody");
		$(targetDiv).empty();

		// constructing the issue dropdown
		var issuedropDown = '<select class="final_status">';
		ISSUE_TYPES.map(function (item)
		{
			issuedropDown += '<option>' + item + '</option>';
		});
		issuedropDown += '</select>';

		$(targetDiv).append('<tr class="item"><td>' + item_id + '</td><td class="barcode">' + barcode + '</td><td><input class="qty" type="text" value="1"/></td><td>' + issuedropDown + '</td><td><input class="note" type="text" /></td></tr>');
	});

	// Checking if all items are snack items, then returning
	if ($("#orders .bill_item_checkbox:checked").length == outside_items)
	{
		return;
	}
	$.ajax({
		type: 'POST',
		url: HQ_URL + '/outlet/refund_items/' + order_id,
		data: JSON.stringify({ "amount": total_price, "item_details": item_details }),
		success: function (data)
		{
			//openOrderItems(order_id, mobile_num, this);
			$("#report-issues-dialog").modal("show");
		},
		error: function (jqxhr, textStatus, error)
		{
			var err_msg = textStatus + ", " + jqxhr.responseText;
			console.error("Refund items failed: " + err_msg);
		},
		contentType: "application/json",
		dataType: "text"
	});
});

$("#report-issues-dialog .modal-footer .submit_report_issue").click(function ()
{
	var barcode_details = [];
	$("#report-issues-dialog .modal-footer .submit_report_issue").prop("disabled", true);
	$("#report-issues-dialog .modal-body #food_issue table tbody tr").each(function (index)
	{
		var barcode = $(this).find(".barcode").text();
		var count = $(this).find(".qty").val();
		var final_status = $(this).find(".final_status").val();
		var problem = "";
		var note = $(this).find(".note").val();
		if (count != '')
		{
			barcode_details.push({ "barcode": barcode, "count": count, "final_status": final_status, "problem": problem, "note": note });
		}
	});
	var non_food_issue = {};
	$.ajax({
		type: 'POST',
		url: OUTLET_URL + '/outlet_app/update_item_issues',
		timeout: 3000,
		data: JSON.stringify({
			"barcode_details": barcode_details,
			"non_food_issue": non_food_issue
		}),
		success: function (data)
		{
			console.log(data);
			$("#report-issues-dialog .modal-footer .submit_report_issue").prop("disabled", false);
			// Hiding the dialog
			$("#report-issues-dialog").modal("hide");
			// Clearing off the temp row that was created
			$("#temp_row").remove();
		},
		error: function (jqxhr, textStatus, error)
		{
			var err_msg = textStatus + ", " + jqxhr.responseText;
			$("#report-issues-dialog .modal-footer .submit_report_issue").prop("disabled", false);
			console.error("Reporting food issue failed: " + err_msg);
		},
		contentType: "application/json",
		dataType: 'text'
	});
});


function openOrderItems(order_id, mobile_num, scope)
{
	// If the row already exists, remove it
	if ($(scope).next().attr("id") == "temp_row")
	{
		$($(scope).children()[0]).find("img").attr("src", "img/icons/Right Arrow.png");
		$("#temp_row").remove();
		return;
	}

	// Setting the down arrow
	$($(scope).children()[0]).find("img").attr("src", "img/icons/Bottom Arrow.png");

	var jqxhr = $.get(HQ_URL + '/outlet/show_bill_items/' + order_id)
	.done(function (data)
	{
		$("#temp_row").remove();
		$(scope).after('<tr id="temp_row"><td colspan="6">\
	  <table id="temp_table" data-order-id="'+ order_id + '" data-mobile_num="' + mobile_num + '" class="table table-striped table-hover">\
	  <thead>\
	  <tr>\
		<th class="bill_no"><div class="checkbox">\
			<label>\
			<input type="checkbox"><span class="checkbox_header">Bill No</span>\
			</label>\
		</div></th>\
		<th>Item Id</th>\
		<th>Name</th>\
		<th>Price</th>\
	  </tr>\
	  </thead>\
	  <tbody>\
	  </tbody>\
	  </table>\
	  <span class="total_text">Total: </span><img class="total_money_icon icon rupee-img" src="img/icons/Rupee.png"><span class="total_money"></span><div id="refund_buttons">\
							<a id="refund" href="javascript:void(0)" class="btn btn-default btn-raised">\
								<img src="img/icons/Refund.png" height="30">\
								<span>Refund</span>\
							</a><a id="replace" href="javascript:void(0)" class="btn btn-default btn-raised">\
								<img src="img/icons/Replace.png" height="30">\
								<span>Replace</span>\
							</a><a id="generate_bill" href="javascript:void(0)" class="btn btn-default btn-raised">\
								<img src="img/icons/Quality.png" height="30">\
								<span>Resend Bill</span>\
							</a></div>\
	  </td></tr>');
		var tableDiv = $("#temp_table tbody");
		console.log('Received bill data for order id - ' + order_id);
		//b.bill_no, b.quantity, f.id, f.name, f.mrp, i.barcode
		var total_price = 0;
		for (var i = 0; i < data.length; i++)
		{
			if (data[i].quantity < 0)
			{
				var sign = -1;
			} else
			{
				var sign = 1;
			}
			for (var j = 0; j < Math.abs(data[i].quantity) ; j++)
			{
				$(tableDiv).append('<tr><td><div class="checkbox"><label><input class="bill_item_checkbox" type="checkbox" data-barcode="' + data[i].barcode + '"><span class="checkbox_header">' + data[i].bill_no + '</span></label></div></td><td>' + data[i].id + '</td><td>' + data[i].name + '</td><td><img class="icon rupee-img" src="img/icons/Rupee.png">' + data[i].mrp * sign + '</td></tr>');
				total_price += (data[i].mrp * sign);
			}
			if (data[i].barcode.startsWith("xxxxx"))
			{
				var sign = 1;
				for (var j = 0; j < Math.abs(data[i].original_quantity) ; j++)
				{
					$(tableDiv).append('<tr><td><div class="checkbox"><label><input class="bill_item_checkbox" type="checkbox" data-barcode="' + data[i].barcode + '"><span class="checkbox_header">' + data[i].bill_no + '</span></label></div></td><td>' + data[i].id + '</td><td>' + data[i].name + '</td><td><img class="icon rupee-img" src="img/icons/Rupee.png">' + data[i].mrp * sign + '</td></tr>');
					total_price += (data[i].mrp * sign);
				}
			}
		}
		$("#temp_row .total_money").text(total_price);
		// Hiding or showing the refund/replace buttons
		var date = $("#orders #date_selector").val();
		//if (date != "" && (! isToday(date))) {
		if (false)
		{
			$("#refund").hide();
			$("#replace").hide();
			$("#refund_buttons").css("margin-left", "1000px");
		} else
		{
			$("#refund").show();
			$("#replace").show();
			$("#refund_buttons").css("margin-left", "700px");
		}
		// Reinitiating the material styles for the new elements
		$.material.ripples();
		$.material.checkbox();
	})
	.fail(function (jqxhr, textStatus, error)
	{
		var err_msg = textStatus + ", " + jqxhr.responseText;
		console.error("Request Failed: " + err_msg);
	});
}

$("#orders .prev_day").click(function ()
{
	var input_value = getSelectedDate();
	if (input_value != 'now')
	{
		var selected = new Date(input_value);
		var prev_day = new Date(selected);
		prev_day.setDate(selected.getDate() - 1);
		$("#orders #date_selector").val(prev_day.yyyymmdd());
	}
	$("#orders #date_selector").trigger("change");
});

$("#orders .next_day").click(function ()
{
	var input_value = getSelectedDate();
	if (input_value != 'now')
	{
		var selected = new Date(input_value);
		var next_day = new Date(selected);
		next_day.setDate(selected.getDate() + 1);
		$("#orders #date_selector").val(next_day.yyyymmdd());
	}
	$("#orders #date_selector").trigger("change");
});

$("#orders #date_selector").change(function ()
{
	// Get the date
	var date = getSelectedDate();
	// populate the new orders again.
	populateOrders(date);
});

// Utility functions
function computeDispenseStatus(dispense_statuses)
{
	var priorityMap = { 'timeout': -1, 'pending': 0, 'dispensing': 1, 'delivered': 2 }
	var dispense_status = 'delivered';
	for (var i = 0; i < dispense_statuses.length; i++)
	{
		if (priorityMap[dispense_status] > priorityMap[dispense_statuses[i]])
		{
			dispense_status = dispense_statuses[i];
		}
	}
	return dispense_status;
}

function getSelectedDate()
{
	var date = $("#orders #date_selector").val();
	if (date == "")
	{
		date = 'now';
	}
	return date;
}



